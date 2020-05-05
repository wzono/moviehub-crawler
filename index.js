const { genCookie, genSegmentArray, random, take, remove, genUserAgent, isBanned, sleep, genWhere, isContain, shuffle } = require("./utils");
const { movieListUrlGetter, doubanReviewListUrlGetter, imdbReviewListUrlGetter } = require("./urls");
const cheerio = require('cheerio')
const { DoubanParser, IMDbParser, IMDbCommentsParser } = require('./parser')
const Async = require('async')
const dbConfig = require("./db.json")
const logger = require("./logger")
const mysql = require('mysql2/promise')
const { TAGS } = require('./conf')
const HttpsProxyAgent = require('https-proxy-agent');
const request = require('request-promise').defaults({
  rejectUnauthorized: false,
  proxyHeaderWhiteList: ['Proxy-Authorization']
})
const proxyConfig = require('./proxy_conf.json')
const crypto = require('crypto')
//////////////////////////////// 配置常量 //////////////////////////////////

const TAG_CONCURRENCY = 10 // 标签并发数
const MOVIE_CONCURRENCY = 80 // 电影详情并发数
const MAX_MOVIE_AMOUNT_EVERY_TAG = 5000 // 每个标签下电影最大数量
const RETRIES = 3 // 出错的重试次数

//////////////////////////////// 配置常量 //////////////////////////////////

//////////////////////////////// 环境变量 /////////////////////////////////
let pool = null
let md5 = crypto.createHash('md5');
let timestamp = parseInt(new Date().getTime() / 1000);
let text = `orderno=${proxyConfig.orderno},secret=${proxyConfig.secret},timestamp=${timestamp}`
md5.update(text);
let sign = md5.digest('hex').toUpperCase();
let jar = request.jar();
jar.setCookie(genCookie(), "https://movie.douban.com")
//////////////////////////////// 环境变量 /////////////////////////////////

//////////////////////////////// 错误类 //////////////////////////////////
const BannedError = {
  code: 'BANNED',
  message: 'Be Banned'
}
const DataError = {
  code: 'INVALID',
  message: 'Data Invalid'
}

const ConcurrentError = {
  code: 'CONCURRENT',
  message: 'Concurrent Exceeds Limit'
}
//////////////////////////////// 错误类 //////////////////////////////////


//////////////////////////////// 工具函数 //////////////////////////////////


function getHeader() {
  const auth = `sign=${sign}&orderno=${proxyConfig.orderno}&timestamp=${timestamp}`
  return {
    'User-Agent': genUserAgent(),
    'Referer': 'https://movie.douban.com/tag/',
    'Proxy-Authorization': auth,
  }
}


function isMovieDataValid(data = {}) {
  return !!data.douban_summary
}


//////////////////////////////// 工具函数 /////////////////////////////////

//////////////////////////////// 逻辑函数 /////////////////////////////////


function getMovieList(uri) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await request({
        uri,
        method: 'get',
        headers: getHeader(),
        agent: HttpsProxyAgent(proxyConfig.url),
        timeout: 5000,
        jar,
      })
      const body = JSON.parse(res)
      if (body.r === 1) {
        reject(BannedError)
        return;
      }
      if (body.code === 200) {
        reject(ConcurrentError)
        return;
      }
      if (!body.data) {
        logger.log(body)
      }
      const data = body.data || [];
      resolve(data)
    } catch (err) {
      if (isContain(err.message, ['403', '503', '502', '登录', 'reset', 'refuse', 'timedout'])) {
        reject(BannedError)
      } else {
        reject(err)
      }
    }
  })
}

function requestAndResolveMovieData(uri, { Parser, checkFunc = () => false, timeout }) {
  return new Promise(async (resolve, reject) => {
    try {
      const html = await request({
        method: 'get',
        uri,
        agent: HttpsProxyAgent(proxyConfig.url),
        headers: getHeader(),
        timeout: timeout || 10000,
        jar,
      })
      const $ = cheerio.load(html)
      if (checkFunc($)) {
        reject(BannedError)
        return;
      }
      const { data } = new Parser($)
      resolve(data)
    } catch (err) {
      if (isContain(err.message, ['404'])) {
        resolve({})
      } else if (isContain(err.message, ['403', '503', '登录', 'reset', 'refuse', '502', '504'])) {
        reject({ ...BannedError, message: err.message.slice(0, 20) })
      } else {
        reject(err)
      }
    }
  })
}


function integratedMovieData(data = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const { url, douban_id: id } = data;
      let imdbRes = {};
      const doubanData = await requestAndResolveMovieData(url, {
        Parser: DoubanParser,
        checkFunc: isBanned
      })
      !isMovieDataValid(doubanData) && reject(DataError)
      if (doubanData.imdb_id) {
        const imdbData = await requestAndResolveMovieData(`https://www.imdb.com/title/${doubanData.imdb_id}`, {
          Parser: IMDbParser,
          timeout: 30000,
        })

        doubanData.pub_year = doubanData.pub_year || imdbData.pub_year
        doubanData.release_date = doubanData.release_date || imdbData.release_date
        doubanData.duration = doubanData.duration || imdbData.duration
        doubanData.cover = doubanData.cover === 'https://img3.doubanio.com/f/movie/30c6263b6db26d055cbbe73fe653e29014142ea3/pics/movie/movie_default_large.png' ? imdbData.cover : doubanData.cover
        imdbRes = {
          imdb_rating: imdbData.imdb_rating,
          imdb_rating_count: imdbData.imdb_rating_count,
          imdb_summary: imdbData.imdb_summary,
        }
      }


      resolve({
        ...doubanData,
        douban_id: id,
        ...imdbRes
      })
    } catch (err) {
      reject(err)
    }
  })
}

function storeMoviesBriefData(arr = []) {
  return new Promise(async resolve => {
    const data = arr.map(({ id: douban_id, title, url }) => ({ douban_id, title, url }))
    let conn = null

    try {
      conn = await pool.getConnection()
      await insertMovieBriefData(conn, data)
    } catch (err) {
      logger.error(err.message)
    } finally {
      conn && conn.release()
      resolve()
    }
  })
}

function storeMovieData(data = {}, retry = 0) {
  return new Promise(async resolve => {
    const {
      directors = [],
      writers = [],
      actors = [],
      genres = [],
      regions = [],
      ...basicData
    } = data
    if (retry >= 5) {
      logger.error(`[FAIL] ${basicData.title} 事务重试失败，已加入Failure队列`);
      await storeFailMovieId(data.douban_id)
      resolve();
      return;
    }

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      const { id: dbMovieId } = await insertMovieBasicData(conn, basicData);
      const dbRegions = await insertRegions(conn, regions);
      await insertMovieRegionRelations(
        conn, dbRegions.map(region => ({ movie_id: dbMovieId, region_id: region.id }))
      );
      const dbDirectors = await insertFilmMen(conn, directors, "director");
      await insertMovieFilmManRelations(
        conn,
        dbDirectors.map(director => ({
          movie_id: dbMovieId,
          director_id: director.id,
        })), "director"
      );
      const dbWriters = await insertFilmMen(conn, writers, "writer");
      await insertMovieFilmManRelations(
        conn,
        dbWriters.map(writer => ({
          movie_id: dbMovieId,
          writer_id: writer.id,
        })), "writer"
      );
      const dbActors = await insertFilmMen(conn, actors, "actor");
      await insertMovieFilmManRelations(
        conn,
        dbActors.map(actor => ({
          movie_id: dbMovieId,
          actor_id: actor.id
        })), "actor"
      );
      const dbGenres = await insertGenres(conn, genres);
      await insertMovieGenreRelations(
        conn,
        dbGenres.map(genre => ({ movie_id: dbMovieId, genre_id: genre.id }))
      );

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      await storeMovieData(data, retry + 1)
      logger.error(err.message)
    } finally {
      conn && conn.release()
      resolve()
    }
  })
}

async function storeFailMovieId(id) {
  let conn = await pool.getConnection()
  try {
    await insert(conn, "failures", {
      douban_id: id,
      reason: "be banned"
    }, false)
  } catch (err) {
    // 吞掉错误
    console.log(err.message)
  } finally {
    conn && conn.release()
  }
}

function fetchAndResolveMovieReviews({ id, douban_id, imdb_id }) {
  return new Promise(async (resolve, reject) => {
    const doubanUrl = doubanReviewListUrlGetter({ douban_id })
    const imdbUrl = imdbReviewListUrlGetter(imdb_id)
    const hasIMDbId = !!imdb_id
    try {
      let doubanReviews = await getDoubanReviews(doubanUrl)
      doubanReviews = doubanReviews.map(item => ({ ...item, source: 'douban', subject_id: id }))
      let imdbReviews = []
      if (hasIMDbId) {
        imdbReviews = await requestAndResolveMovieData(imdbUrl, { Parser: IMDbCommentsParser, timeout: 30000 })
        imdbReviews = imdbReviews.map(item => ({ ...item, source: 'imdb', subject_id: id }))
      }

      resolve([...doubanReviews, ...imdbReviews])
    } catch (err) {
      reject(err)
    }
  })
}

function storeMovieReviews(title, data, retry = 0) {
  return new Promise(async resolve => {
    if (retry >= RETRIES) {
      logger.error(`[FAIL] ${title} 事务重试失败，已加入Failure队列`);
      resolve();
      return;
    }

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      await insertReviews(conn, data)
      await conn.commit()
    } catch (err) {
      await conn.rollback();
      await storeMovieReviews(title, data, retry + 1)
      logger.error(err.message)
    } finally {
      conn && conn.release()
      resolve()
    }
  })
}

function getDoubanReviews(uri) {
  return new Promise(async (resolve, reject) => {
    try {
      const data = await request({
        uri,
        method: 'get',
        headers: getHeader(),
        agent: HttpsProxyAgent(proxyConfig.url),
        timeout: 5000,
        jar,
      })
      const body = JSON.parse(data)
      if (body.r === 1) {
        reject(BannedError)
        return;
      }
      if (body.code === 200) {
        reject(ConcurrentError)
        return;
      }
      const reviews = body.reviews || []
      resolve(reviews.map(({ title, created_at, content, author, useful_count, rating }) => ({
        title,
        created_at,
        content: content.split('\n').map(s => s.trim()).filter(s => s).join('\n\n'),
        useful_count,
        rating: rating.value * 2,
        author: author.name
      })))
    } catch (err) {
      if (isContain(err.message, ['403', '503', '502', '登录', 'reset', 'refuse', 'timedout'])) {
        reject(BannedError)
      } else {
        reject(err)
      }
    }
  })
}


//////////////////////////////// 逻辑函数 /////////////////////////////////

//////////////////////////////// 数据库函数 ///////////////////////////////

function isMovieStored(connection, douban_id) {
  return new Promise(async (resolve) => {
    const where = genWhere({ douban_id, })
    const [values] = await connection.query(
      `SELECT * FROM movies where ${where}`
    );
    resolve(values.length > 0);
  })
}

function removeMovieBrief(douban_id) {
  return new Promise(async resolve => {
    let conn = null
    try {
      conn = await pool.getConnection()
      const where = genWhere({ douban_id, })
      await conn.query(`DELETE FROM brief_movies where ${where}`)
    } catch (e) {
      logger.error(e.message)
    } finally {
      conn && conn.release()
      resolve()
    }
  })
}

function insert(connection, table, data = {}, needQuery = true, queryKey = '') {
  return new Promise(async (resolve, reject) => {
    let returnValue = "";
    try {
      await connection.query(`INSERT IGNORE INTO ${table} set ?`, [data]);
      if (needQuery) {
        returnValue = await getInsertData(connection, table, data, queryKey);
      }
      resolve(returnValue);
    } catch (err) {
      reject(err);
    }
  });
}

function getInsertData(connection, table, dataObj = {}, queryKey = '') {
  return new Promise(async (resolve, reject) => {
    try {
      if (queryKey) {
        dataObj = {
          [queryKey]: dataObj[queryKey]
        }
      }
      const where = genWhere(dataObj);
      const [values] = await connection.query(
        `SELECT * FROM ${table} where ${where}`
      );
      resolve(values[values.length - 1] || {});
    } catch (err) {
      reject(err);
    }
  });
}

function insertMovieBasicData(connection, data) {
  return insert(connection, "movies", data, true, "douban_id");
}

function insertMovieBriefData(connection, data = []) {
  return Promise.all(data.map(item => insert(connection, "brief_movies", item, false)))
}

function insertFilmMen(connection, filmMen, role) {
  return new Promise(async (resolve, reject) => {
    try {
      const filmMenObject = filmMen.map(filmMan => ({ name: filmMan }));
      const data = await Promise.all(
        filmMenObject.map(filmMan => insert(connection, role + "s", filmMan, true, "name"))
      );
      resolve(data);
    } catch (err) {
      reject(err);
    }
  });
}

function insertMovieFilmManRelations(connection, relations, role) {
  return new Promise(async (resolve, reject) => {
    try {
      await Promise.all(
        relations.map(relation =>
          insert(connection, `movie_${role}`, relation, false)
        )
      );
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function insertGenres(connection, genres) {
  return new Promise(async (resolve, reject) => {
    try {
      const data = await Promise.all(
        genres.map(genre => insert(connection, "genres", { name: genre }, true, "name"))
      );
      resolve(data);
    } catch (err) {
      reject(err);
    }
  });
}

function insertMovieGenreRelations(connection, relations) {
  return new Promise(async (resolve, reject) => {
    try {
      await Promise.all(
        relations.map(relation => insert(connection, "movie_genre", relation, false))
      );
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function insertRegions(connection, regions) {
  return new Promise(async (resolve, reject) => {
    try {
      const regionsObject = regions.map(region => ({ name: region }));
      const data = await Promise.all(
        regionsObject.map(region => insert(connection, "regions", region, true, "name"))
      );
      resolve(data);
    } catch (err) {
      reject(err);
    }
  });
}

function insertMovieRegionRelations(connection, relations) {
  return new Promise(async (resolve, reject) => {
    try {
      await Promise.all(
        relations.map(relation => insert(connection, "movie_region", relation, false))
      );
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function getMovieBriefUnused() {
  return new Promise(async (resolve, reject) => {
    let conn = null
    try {
      conn = await pool.getConnection();
      const [values] = await conn.query(
        "select * from brief_movies where (select count(1) as num from movies where movies.douban_id = brief_movies.douban_id) = 0"
      );
      resolve(values);
    } catch (err) {
      reject(err);
    } finally {
      conn && conn.release()
    }
  })
}

function getMovieNoReviews() {
  return new Promise(async (resolve, reject) => {
    let conn = null
    try {
      conn = await pool.getConnection();
      const [values] = await conn.query(
        "select id, title, douban_id, imdb_id from movies where id not in (select cast(subject_id as SIGNED) from reviews)");
      resolve(values);
    } catch (err) {
      reject(err);
    } finally {
      conn && conn.release()
    }
  })
}

function insertReviews(connection, reviews) {
  return new Promise(async (resolve, reject) => {
    try {
      const data = await Promise.all(
        reviews.map(review => insert(connection, "reviews", review, false))
      );
      resolve(data);
    } catch (err) {
      reject(err);
    }
  });
}

//////////////////////////////// 数据库函数 ///////////////////////////////

//////////////////////////////// Tasks //////////////////////////////////


function TaskForMovieBriefs() {
  return new Promise(resolve => {
    const statistics = {}
    let index = 0
    const taskQueue = Async.queue((tag, callback) => {
      TaskForMovieBriefsByTag(tag).then(count => {
        index++
        statistics[tag] = count
        logger.log(`[${tag} - ${index}] Complete. `)
      }).finally(() => sleep(random(1000, 2000)).then(callback))
    }, TAG_CONCURRENCY)

    taskQueue.drain(() => {
      resolve(statistics)
    })
    taskQueue.error(err => {
      resolve(err)
    })
    taskQueue.push(TAGS)
  })
}

function TaskForMovieBriefsByTag(tag) {
  return new Promise(resolve => {
    let current = 0
    let initialSegInfo = {
      start: 0,
      limit: 100,
      retry: 0,
    }
    const taskQueue = Async.queue((segInfo, callback) => {
      const { start, limit, retry = 0 } = segInfo
      const dest = start + limit - 1
      const url = movieListUrlGetter({ limit, start, genres: tag })
      if (retry > RETRIES) {
        logger.error(`[FAIL][MovieBriefList][${tag}][${start}-${dest}]`)
        callback()
        return
      }

      getMovieList(url).then(async data => {
        if (data && data.length === 0 || current > MAX_MOVIE_AMOUNT_EVERY_TAG) {
          // 说明已经获取完毕，之后的数据是无效的
        } else {
          await storeMoviesBriefData(data)  // storeMovieBriefData函数内部吞掉错误
          current += data.length
          logger.log(`[OK][MovieBriefList][${tag}][${start}-${dest}]`)
          taskQueue.push({
            start: start + limit,
            limit: 100,
            retry: 0,
          })
        }
      }).catch(err => {
        logger.log(`[Retry: ${retry}][MovieBriefList][${tag}][${start}-${dest}] ${err && err.message} `)
        taskQueue.unshift({
          ...segInfo,
          retry: retry ? retry + 1 : 1
        })
      }).finally(() => sleep(random(1000, 2000)).then(callback))

    }, 1)

    taskQueue.push(initialSegInfo)
    taskQueue.drain(() => {
      resolve(current)
    })
    taskQueue.error(err => {
      resolve(err)
    })
  })
}

function TaskForMovieDetails() {
  return new Promise(async resolve => {
    let total = 0;
    let current = 0;
    let briefs = []
    try {
      briefs = await getMovieBriefUnused()
      total = briefs.length
    } catch (err) {
      logger.error(err.message)
    }

    const queue = Async.queue((item, callback) => {
      (async () => {
        if (item.retry && item.retry > RETRIES) {
          logger.error(`[FAIL] ${item.title} 重试失败`)
          callback()
          return
        }

        try {
          const data = await integratedMovieData(item) // 抛出格式错误/请求错误/Banned错误
          await storeMovieData(data) // 不会抛错
          current++
          logger.log(`[OK][${current}/${total}][${item.douban_id}] ${item.title} `);
        } catch (err) {
          err && logger.error(`[FAIL] ${item.title}, Reason: ${err && err.message}`)
          err && err.code !== DataError.code && queue.unshift({ ...item, retry: item.retry ? item.retry + 1 : 1 }) // 无需存储数据格式错误的电影数据
          err && err.code === DataError.code && await removeMovieBrief(item.douban_id)
        } finally {
          await sleep(random(1000, 2000))
          callback()
        }
      })()
    }, MOVIE_CONCURRENCY)

    queue.drain(() => {
      resolve(total)
    })

    queue.error((err) => {
      logger.error(err.message)
      resolve(total)
    })

    queue.push(briefs)
  })
}

function TaskForMovieReviews() {
  return new Promise(async resolve => {
    let movies = []
    let total = 0
    let current = 0
    let reviewsCount = 0
    try {
      movies = await getMovieNoReviews();
      movies = shuffle(movies)
      total = movies.length
    } catch (err) {
      logger.error(err.message)
    }

    const queue = Async.queue((item, callback) => {
      (async () => {
        const { id, title, retry, douban_id } = item;

        if (retry && retry > RETRIES) {
          logger.error(`[FAIL] ${item.title} 重试失败`)
          callback()
          return
        }

        try {
          const data = await fetchAndResolveMovieReviews(item)
          await storeMovieReviews(title, data)
          current++;
          reviewsCount += data.length
          logger.log(`[OK][${current}/${total}][${douban_id}] ${title} - ${data.length} 条影评`);
        } catch (err) {
          err && logger.error(`[FAIL] ${title}, Reason: ${err && err.message}`)
          queue.unshift({ ...item, retry: retry ? retry + 1 : 1 }) // 重试
        } finally {
          await sleep(random(1000, 2000))
          callback()
        }

      })()
    }, MOVIE_CONCURRENCY)

    queue.drain(() => {
      resolve(reviewsCount)
    })

    queue.error((err) => {
      logger.error(err.message)
      resolve(reviewsCount)
    })

    queue.push(movies)
  })
}

async function initialTask() {
  pool = await mysql.createPool({ ...dbConfig, connectionLimit: 200, })
}

async function mainTask() {
  const params = process.argv.splice(2)
  const skipTaskForBriefs = params.includes('-nb')
  const skipTaskForDetails = params.includes('-nd')
  try {
    logger.log("开始初始化...")
    await initialTask();
    logger.log("初始化完成.")

    if (!skipTaskForBriefs) {
      logger.log("开始爬取电影列表...")
      const stat = await TaskForMovieBriefs() // 所有目标电影爬取完毕
      Object.keys(stat).forEach(key => logger.log(`[${key}]: ${stat[key]}`))
      logger.log("电影列表爬取完成.")
    }

    if (!skipTaskForDetails) {
      logger.log("开始爬取电影详细信息...")
      const total = await TaskForMovieDetails() // 所有电影详细数据爬取完毕
      logger.log(`电影详细信息爬取完成: ${total} 部.`)
    }

    logger.log("开始爬取电影评论...")
    const total = await TaskForMovieReviews()
    logger.log(`电影影评爬取完成: ${total} 条.`)
  } catch (err) {
    logger.error(err.message)
  } finally {
    await pool.end()
  }
}

mainTask().catch(err => logger.error(err.message)).finally(() => {
  logger.log('Finished.')
})