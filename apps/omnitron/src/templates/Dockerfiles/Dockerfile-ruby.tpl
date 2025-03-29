FROM anapsix/alpine-ruby:latest

RUN apk update && apk add git && rm -rf /var/cache/apk/*
RUN npm install omnitron@next -g
RUN mkdir -p /var/app

WORKDIR /var/app
