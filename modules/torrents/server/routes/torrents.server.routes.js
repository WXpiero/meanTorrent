'use strict';

/**
 * Module dependencies
 */
var torrents = require('../controllers/torrents.server.controller'),
  torrentsPolicy = require('../policies/torrents.server.policy');


module.exports = function (app) {
  app.route('/api/movieinfo/:tmdbid/:language').all(torrentsPolicy.isAllowed)
    .get(torrents.movieinfo);
  app.route('/api/tvinfo/:tmdbid/:language').all(torrentsPolicy.isAllowed)
    .get(torrents.tvinfo);
  app.route('/api/search/movie/:language').all(torrentsPolicy.isAllowed)
    .get(torrents.searchmovie);


  app.route('/api/torrents/upload').all(torrentsPolicy.isAllowed)
    .post(torrents.upload);

  app.route('/api/torrents/uploadTorrentCover').all(torrentsPolicy.isAllowed)
    .post(torrents.uploadTorrentCover);

  app.route('/api/torrents/uploadTorrentImage').all(torrentsPolicy.isAllowed)
    .post(torrents.uploadTorrentImage);

  app.route('/api/torrents/announceEdit').all(torrentsPolicy.isAllowed)
    .post(torrents.announceEdit);

  app.route('/api/torrents/download/:torrentId').all(torrentsPolicy.isAllowed)
    .get(torrents.download);
  app.route('/api/torrents/download/:torrentId/:passkey').all(torrentsPolicy.isAllowed)
    .get(torrents.download);

  app.route('/api/torrents').all(torrentsPolicy.isAllowed)
    .get(torrents.list)
    .post(torrents.create);
  app.route('/api/rss/:passkey').all(torrentsPolicy.isAllowed)
    .get(torrents.makeRss);

  app.route('/api/torrents/siteInfo')
    .get(torrents.siteInfo);

  app.route('/api/torrents/homeList')
    .get(torrents.getTorrentsHomeList);

  app.route('/api/torrents/countNewTorrents')
    .get(torrents.countNewTorrents);

  app.route('/api/torrents/:torrentId').all(torrentsPolicy.isAllowed)
    .get(torrents.read)
    .put(torrents.update)
    .delete(torrents.delete);

  app.route('/api/torrents/:torrentId/thumbsUp').all(torrentsPolicy.isAllowed)
    .put(torrents.thumbsUp);

  app.route('/api/torrents/:torrentId/rating').all(torrentsPolicy.isAllowed)
    .put(torrents.rating);

  app.route('/api/torrents/:torrentId/seederUsers').all(torrentsPolicy.isAllowed)
    .get(torrents.getSeederUsers);

  app.route('/api/torrents/:torrentId/leecherUsers').all(torrentsPolicy.isAllowed)
    .get(torrents.getLeecherUsers);

  app.route('/api/torrents/:torrentId/toggleHnRStatus').all(torrentsPolicy.isAllowed)
    .put(torrents.toggleHnRStatus);

  app.route('/api/torrents/:torrentId/toggleVIPStatus').all(torrentsPolicy.isAllowed)
    .put(torrents.toggleVIPStatus);

  app.route('/api/torrents/:torrentId/toggleTOPStatus').all(torrentsPolicy.isAllowed)
    .put(torrents.toggleTOPStatus);

  app.route('/api/torrents/:torrentId/toggleUniqueStatus').all(torrentsPolicy.isAllowed)
    .put(torrents.toggleUniqueStatus);

  app.route('/api/torrents/:torrentId/set/saletype/:saleType').all(torrentsPolicy.isAllowed)
    .put(torrents.setSaleType);

  app.route('/api/torrents/:torrentId/set/recommendlevel/:rlevel').all(torrentsPolicy.isAllowed)
    .put(torrents.setRecommendLevel);

  app.route('/api/torrents/:torrentId/set/reviewed').all(torrentsPolicy.isAllowed)
    .put(torrents.setReviewedStatus);

  app.route('/api/torrents/:torrentId/set/tags').all(torrentsPolicy.isAllowed)
    .put(torrents.setTorrentTags);

  app.param('torrentId', torrents.torrentByID);
};
