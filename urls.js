exports.movieListUrlGetter = ({ limit = 100, genres = '', start = 0 }) => `https://movie.douban.com/j/new_search_subjects?sort=T&range=1,10&start=${start}&limit=${limit}&tags=${encodeURIComponent("电影")}&genres=${encodeURIComponent(genres)}`

exports.doubanReviewListUrlGetter = ({limit = 75, douban_id}) => `https://api.douban.com/v2/movie/subject/${douban_id}/reviews?apikey=0df993c66c0c636e29ecbb5344252a4a&start=0&count=${limit}`

exports.imdbReviewListUrlGetter = (imdb_id) => `https://www.imdb.com/title/${imdb_id}/reviews`