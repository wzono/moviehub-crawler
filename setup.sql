drop database if exists movies_hub;
create database movies_hub;
use movies_hub;

SET time_zone = "+00:00";
SET SESSION sql_mode = 'STRICT_ALL_TABLES';

create table if not exists actors
(
    id   int auto_increment,
    name varchar(80) null,
    constraint actors_id_uindex
        unique (id),
    constraint actors_name_uindex
        unique (name)
);

alter table actors
    add primary key (id);

create table if not exists brief_movies
(
    douban_id varchar(32)   not null,
    title     varchar(128)  not null,
    url       varchar(1024) not null,
    primary key (douban_id)
);

create index brief_movies_douban_id_uindex
    on brief_movies (douban_id);

create table if not exists directors
(
    id   int auto_increment,
    name varchar(80) not null,
    constraint directors_id_uindex
        unique (id),
    constraint directors_name_uindex
        unique (name)
);

alter table directors
    add primary key (id);

create table if not exists failures
(
    douban_id varchar(32) not null,
    reason    text        null,
    constraint failures_douban_id_uindex
        unique (douban_id)
);

alter table failures
    add primary key (douban_id);

create table if not exists genres
(
    id   int auto_increment comment '分类标识',
    name char(5) not null comment '分类名称',
    constraint genres_id_uindex
        unique (id),
    constraint genres_name_uindex
        unique (name)
);

alter table genres
    add primary key (id);

create table if not exists movie_actor
(
    movie_id int not null,
    actor_id int not null,
    primary key (movie_id, actor_id)
);

create index movie_actor_actor_id_index
    on movie_actor (actor_id);

create index movie_actor_movie_id_index
    on movie_actor (movie_id);

create table if not exists movie_director
(
    movie_id    int not null,
    director_id int not null,
    primary key (movie_id, director_id)
);

create index movie_director_director_id_index
    on movie_director (director_id);

create index movie_director_movie_id_index
    on movie_director (movie_id);

create table if not exists movie_genre
(
    movie_id int not null comment '电影id',
    genre_id int not null comment '分类id',
    primary key (movie_id, genre_id)
);

create index movie_genre_genre_id_index
    on movie_genre (genre_id);

create index movie_genre_movie_id_index
    on movie_genre (movie_id);

create table if not exists movie_region
(
    movie_id  int not null comment '电影id',
    region_id int not null comment '区域id',
    primary key (movie_id, region_id)
);

create index movie_region_movie_id_index
    on movie_region (movie_id);

create index movie_region_region_id_index
    on movie_region (region_id);

create table if not exists movie_writer
(
    movie_id  int not null,
    writer_id int not null,
    primary key (movie_id, writer_id)
);

create index movie_writer_movie_id_index
    on movie_writer (movie_id);

create index movie_writer_writer_id_index
    on movie_writer (writer_id);

create table if not exists movies
(
    id                  int auto_increment comment 'id',
    cover               varchar(1024) default ''  not null comment '封面',
    title               varchar(128)  default ''  not null comment '名称',
    origin_title        varchar(128)  default ''  not null comment '原名',
    douban_rating_count int           default 0   not null comment '豆瓣评分人数',
    douban_rating       decimal(2, 1) default 0.0 not null comment '豆瓣评分',
    douban_id           varchar(32)               null comment '豆瓣id',
    douban_summary      text                      null comment '豆瓣简介',
    pub_year            int                       null comment '电影年代',
    release_date        datetime                  null comment '上映时间',
    duration            smallint      default 0   not null comment '片长',
    alias               varchar(256)  default ''  not null comment '别名',
    imdb_rating         decimal(2, 1) default 0.0 not null comment 'imdb评分',
    imdb_rating_count   int           default 0   not null comment 'imdb评分人数',
    imdb_summary        text                      null comment 'imdb简介',
    imdb_id             varchar(32)   default ''  not null comment 'imdb_id',
    lang                varchar(32)   default ''  not null comment '语言',
    virtual_keywords    varchar(500) as (concat_ws(_utf8mb4'', `title`, `origin_title`, `alias`)),
    constraint movies_douban_id_uindex
        unique (douban_id),
    constraint movies_id_uindex
        unique (id)
);

create index movies_imdb_id_index
    on movies (imdb_id);

create index movies_virtual_keywords_index
    on movies (virtual_keywords);

alter table movies
    add primary key (id);

create table if not exists regions
(
    id   int auto_increment comment '地域id'
        primary key,
    name varchar(32) not null comment '地域名称',
    constraint regions_name_uindex
        unique (name)
);

create index regions_id_index
    on regions (id);

create table if not exists writers
(
    id   int auto_increment
        primary key,
    name varchar(80) not null,
    constraint writers_name_uindex
        unique (name)
);

create index writers_id_index
    on writers (id);


create table if not exists reviews
(
    id           int auto_increment comment 'id'
        primary key,
    content      text                           not null comment '内容',
    title        varchar(128)  default ''       not null comment '标题',
    author       varchar(60)   default '匿名'     not null comment '作者',
    created_at   datetime                       null comment '发布时间',
    rating       decimal(2, 1) default 0.0      not null comment '评分',
    useful_count int           default 0        not null comment '有用数',
    subject_id   int                            not null comment '电影id',
    source       char(7)       default 'douban' not null comment 'douban/imdb'
);

create index reviews_subject_id_index
    on reviews (subject_id);


