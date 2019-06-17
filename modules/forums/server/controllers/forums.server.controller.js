'use strict';

/**
 * Module dependencies
 */
var path = require('path'),
  config = require(path.resolve('./config/config')),
  mongoose = require('mongoose'),
  errorHandler = require(path.resolve('./modules/core/server/controllers/errors.server.controller')),
  multer = require('multer'),
  fs = require('fs'),
  moment = require('moment'),
  User = mongoose.model('User'),
  Forum = mongoose.model('Forum'),
  Topic = mongoose.model('Topic'),
  Reply = mongoose.model('Reply'),
  Thumb = mongoose.model('Thumb'),
  async = require('async'),
  scoreUpdate = require(path.resolve('./config/lib/score')).update,
  traceLogCreate = require(path.resolve('./config/lib/tracelog')).create;

var traceConfig = config.meanTorrentConfig.trace;
var scoreConfig = config.meanTorrentConfig.score;
var serverMessage = require(path.resolve('./config/lib/server-message'));
var serverNoticeConfig = config.meanTorrentConfig.serverNotice;
var itemsPerPageConfig = config.meanTorrentConfig.itemsPerPage;
var appConfig = config.meanTorrentConfig.app;

var mtDebug = require(path.resolve('./config/lib/debug'));

/**
 * list forums
 * @param req
 * @param res
 */
exports.list = function (req, res) {
  var condition = {};

  if (!req.user || !req.user.isOper) {
    condition.operOnly = false;
  }
  if (!req.user || (!req.user.isOper && !req.user.isVip)) {
    condition.vipOnly = false;
  }

  var findForumsList = function (callback) {
    Forum.find(condition)
      .sort('category order -createdat')
      .populate({
        path: 'lastTopic',
        populate: {
          path: 'user lastUser',
          select: 'username displayName profileImageURL isVip score uploaded downloaded'
        }
      })
      .populate('moderators', 'username displayName profileImageURL isVip score uploaded downloaded')
      .exec(function (err, forums) {
        if (err) {
          callback(err, null);
        } else {
          callback(null, forums);
        }
      });
  };

  var forumsTopicsCount = function (callback) {

    Topic.aggregate([{
      // $match: condition,
      $project: {
        'forum': '$forum',
        'year': {
          '$year': {'$add': ['$createdAt', appConfig.dbTimeZone * 60 * 1000]}
        },
        'month': {
          '$month': {'$add': ['$createdAt', appConfig.dbTimeZone * 60 * 1000]}
        },
        'day': {
          '$dayOfMonth': {'$add': ['$createdAt', appConfig.dbTimeZone * 60 * 1000]}
        }
      }
    }, {
      $match: {
        year: moment().utcOffset(appConfig.dbTimeZone).year(),
        month: moment().utcOffset(appConfig.dbTimeZone).month() + 1,
        day: moment().utcOffset(appConfig.dbTimeZone).date()
      }
    }, {
      $group: {
        _id: '$forum',
        count: {$sum: 1}
      }
    }]).exec(function (err, counts) {
      if (err) {
        callback(err, null);
      } else {
        callback(null, counts);
      }
    });
  };

  var forumsRepliesCount = function (callback) {
    Topic.aggregate([{
      $unwind: '$_replies'
    }, {
      $project: {
        'forum': '$forum',
        'year': {
          '$year': {'$add': ['$_replies.createdAt', appConfig.dbTimeZone * 60 * 1000]}
        },
        'month': {
          '$month': {'$add': ['$_replies.createdAt', appConfig.dbTimeZone * 60 * 1000]}
        },
        'day': {
          '$dayOfMonth': {'$add': ['$_replies.createdAt', appConfig.dbTimeZone * 60 * 1000]}
        }
      }
    }, {
      $match: {
        year: moment().utcOffset(appConfig.dbTimeZone).year(),
        month: moment().utcOffset(appConfig.dbTimeZone).month() + 1,
        day: moment().utcOffset(appConfig.dbTimeZone).date()
      }
    }, {
      $group: {
        _id: '$forum',
        count: {$sum: 1}
      }
    }]).exec(function (err, counts) {
      if (err) {
        callback(err, null);
      } else {
        callback(null, counts);
      }
    });
  };

  async.parallel([findForumsList, forumsTopicsCount, forumsRepliesCount], function (err, results) {
    if (err) {
      return res.status(422).send(err);
    } else {
      res.json({
        forumsList: results[0],
        forumsTopicsCount: results[1],
        forumsRepliesCount: results[2]
      });
    }
  });
};

/**
 * read forum
 * @param req
 * @param res
 */
exports.read = function (req, res) {
  var forum = req.forum;
  var user = req.user;

  if (forum.vipOnly && !user.isVip && !user.isOper) {
    return res.status(422).send({
      redirect: 'forums.list'
    });
  } else if (forum.operOnly && !user.isOper) {
    return res.status(422).send({
      redirect: 'forums.list'
    });
  } else {
    res.json(req.forum);
  }
};

/**
 * forumsSearch
 * @param req
 * @param res
 */
exports.forumsSearch = function (req, res) {
  var condition = {};
  var keysA = [];
  var skip = 0;
  var limit = 0;

  if (req.body.skip !== undefined) {
    skip = parseInt(req.body.skip, 10);
  }
  if (req.body.limit !== undefined) {
    limit = parseInt(req.body.limit, 10);
  }

  if (req.body.keys && req.body.keys.length > 0) {
    var keysS = req.body.keys + '';
    var keysT = keysS.split(' ');

    keysT.forEach(function (it) {
      var ti = new RegExp(it, 'i');
      keysA.push(ti);
    });
  }

  if (req.body.forumId) {
    condition.forum = req.body.forumId;
  }

  if (keysA.length > 0) {
    condition.$or = [
      {title: {'$all': keysA}},
      {content: {'$all': keysA}},
      {'_replies.content': {'$all': keysA}},
      {'_attach.filename': {'$all': keysA}},
      {'_replies._attach.filename': {'$all': keysA}}
    ];
  }

  var countQuery = function (callback) {
    Topic.count(condition, function (err, count) {
      if (err) {
        callback(err, null);
      } else {
        callback(null, count);
      }
    });
  };

  var findQuery = function (callback) {
    Topic.find(condition)
      .sort('-lastReplyAt -createdAt')
      .populate('user', 'username displayName profileImageURL isVip score uploaded downloaded')
      .populate('lastUser', 'username displayName profileImageURL isVip score uploaded downloaded')
      .populate('forum', 'name category')
      .skip(skip)
      .limit(limit)
      .exec(function (err, topics) {
        if (err) {
          callback(err, null);
        } else {
          callback(null, topics);
        }
      });
  };

  async.parallel([countQuery, findQuery], function (err, results) {
    if (err) {
      return res.status(422).send(err);
    } else {
      res.json({rows: results[1], total: results[0]});
    }
  });
};

/**
 * listTopics
 * @param req
 * @param res
 */
exports.listTopics = function (req, res) {
  var skip = 0;
  var limit = 0;

  if (req.query.skip !== undefined) {
    skip = parseInt(req.query.skip, 10);
  }
  if (req.query.limit !== undefined) {
    limit = parseInt(req.query.limit, 10);
  }

  var countQuery = function (callback) {
    Topic.count({
      forum: req.params.forumId
    }, function (err, count) {
      if (err) {
        callback(err, null);
      } else {
        callback(null, count);
      }
    });
  };

  var findQuery = function (callback) {
    Topic.find({
      forum: req.params.forumId
    })
      .sort('-isTop -lastReplyAt -createdAt')
      .populate('user', 'username displayName profileImageURL isVip score uploaded downloaded')
      .populate('lastUser', 'username displayName profileImageURL isVip score uploaded downloaded')
      .skip(skip)
      .limit(limit)
      .exec(function (err, topics) {
        if (err) {
          callback(err, null);
        } else {
          callback(null, topics);
        }
      });
  };

  async.parallel([countQuery, findQuery], function (err, results) {
    if (err) {
      return res.status(422).send(err);
    } else {
      res.json({rows: results[1], total: results[0]});
    }
  });
};

/**
 * getHomeHelpTopic
 * @param req
 * @param res
 */
exports.getHomeHelpTopic = function (req, res) {
  var skip = 0;
  var limit = itemsPerPageConfig.homeHelpListLimit;

  Topic.find({
    isHomeHelp: true
  })
    .sort('-pushHomeAt')
    .populate('user', 'username displayName profileImageURL isVip score uploaded downloaded')
    .skip(skip)
    .limit(limit)
    .exec(function (err, topics) {
      if (err) {
        return res.status(422).send(err);
      } else {
        res.json(topics);
      }
    });
};

/**
 * getHomeNoticeTopic
 * @param req
 * @param res
 */
exports.getHomeNoticeTopic = function (req, res) {
  var skip = 0;
  var limit = itemsPerPageConfig.homeNoticeListLimit;

  Topic.find({
    isHomeNotice: true
  })
    .sort('-pushHomeAt')
    .populate('user', 'username displayName profileImageURL isVip score uploaded downloaded')
    .skip(skip)
    .limit(limit)
    .exec(function (err, topics) {
      if (err) {
        return res.status(422).send(err);
      } else {
        res.json(topics);
      }
    });
};

/**
 * getHomeNewTopic
 * @param req
 * @param res
 */
exports.getHomeNewTopic = function (req, res) {
  var skip = 0;
  var limit = itemsPerPageConfig.homeNewTopicListLimit;

  Topic.find()
    .sort('-createdAt')
    .populate('user', 'username displayName profileImageURL isVip score uploaded downloaded')
    .skip(skip)
    .limit(limit)
    .exec(function (err, topics) {
      if (err) {
        return res.status(422).send(err);
      } else {
        res.json(topics);
      }
    });
};

/**
 * globalTopics
 * @param req
 * @param res
 */
exports.globalTopics = function (req, res) {
  var user = req.user;

  Forum.find().exec(function (err, forums) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      var ids = forums.map(function (el) {
        if (el.vipOnly && !user.isVip && !user.isOper) {
          return undefined;
        } else if (el.operOnly && !user.isOper) {
          return undefined;
        } else {
          return el._id;
        }
      });

      mtDebug.debugBlue(ids, 'FORUMS_ID_LIST');

      Topic.find({
        isGlobal: true,
        forum: {$in: ids}
      })
        .sort('-createdAt')
        .populate('forum', 'name')
        .populate('user', 'username displayName profileImageURL isVip score uploaded downloaded')
        .populate('lastUser', 'username displayName profileImageURL isVip score uploaded downloaded')
        .exec(function (err, topics) {
          if (err) {
            return res.status(422).send({
              message: errorHandler.getErrorMessage(err)
            });
          }
          res.json(topics);
        });
    }
  });
};

/**
 * postNewTopic
 * @param req
 * @param res
 */
exports.postNewTopic = function (req, res) {
  var user = req.user;
  var forum = req.forum;
  var topic = new Topic(req.body);
  topic.forum = forum;
  topic.user = req.user;

  //move temp torrent file to dest directory
  req.body._uImage.forEach(function (f) {
    var oldPath = config.uploads.attach.file.temp + f.filename;
    var newPath = config.uploads.attach.file.dest + f.filename;
    move(oldPath, newPath, function (err) {
      if (err) {
        mtDebug.debugRed(err);
      }
    });
  });
  req.body._attach.forEach(function (f) {
    var oldPath = config.uploads.attach.file.temp + f.filename;
    var newPath = config.uploads.attach.file.dest + f.filename;
    move(oldPath, newPath, function (err) {
      if (err) {
        mtDebug.debugRed(err);
      }
    });
  });

  //replace content path
  var tmp = config.uploads.attach.file.temp.substr(1);
  var dst = config.uploads.attach.file.dest.substr(1);

  var regex = new RegExp(tmp, 'g');
  topic.content = topic.content.replace(regex, dst);

  //save topic
  topic.save(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);

      forum.update({
        $inc: {topicCount: 1},
        lastTopic: topic
      }).exec();

      user.update({
        $inc: {topics: 1}
      }).exec();
    }
  });
};

/**
 * move file
 * @param oldPath
 * @param newPath
 * @param callback
 */
function move(oldPath, newPath, callback) {
  fs.rename(oldPath, newPath, function (err) {
    if (err) {
      if (err.code === 'EXDEV') {
        copy();
      } else {
        callback(err);
      }
      return;
    }
    callback();
  });

  function copy() {
    var readStream = fs.createReadStream(oldPath);
    var writeStream = fs.createWriteStream(newPath);

    readStream.on('error', callback);
    writeStream.on('error', callback);

    readStream.on('close', function () {
      fs.unlink(oldPath, callback);
    });
    readStream.pipe(writeStream);
  }
}

/**
 * read readTopic
 * @param req
 * @param res
 */
exports.readTopic = function (req, res) {
  var topic = req.topic;

  topic.update({
    $inc: {viewCount: 1}
  }).exec();

  res.json(topic);
};

/**
 * updateTopic
 * @param req
 * @param res
 */
exports.updateTopic = function (req, res) {
  var forum = req.forum;
  var topic = req.topic;

  if (!canEdit(req.user, forum) && !isOwner(req.user, topic)) {
    return res.status(403).json({
      message: 'SERVER.USER_IS_NOT_AUTHORIZED'
    });
  }

  topic.title = req.body.title;
  topic.content = req.body.content;
  topic.updatedAt = Date.now();
  topic.updatedBy = req.user;

  topic.save(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);
    }
  });
};

/**
 * toggleTopicReadonly
 * @param req
 * @param res
 */
exports.toggleTopicReadonly = function (req, res) {
  var forum = req.forum;
  var topic = req.topic;

  if (!canEdit(req.user, forum) && !isOwner(req.user, topic)) {
    return res.status(403).json({
      message: 'SERVER.USER_IS_NOT_AUTHORIZED'
    });
  }

  topic.readOnly = !topic.readOnly;

  topic.save(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);
    }
  });
};

/**
 * toggleTopicTopStatus
 * @param req
 * @param res
 */
exports.toggleTopicTopStatus = function (req, res) {
  var forum = req.forum;
  var topic = req.topic;

  if (!canEdit(req.user, forum)) {
    return res.status(403).json({
      message: 'SERVER.USER_IS_NOT_AUTHORIZED'
    });
  }

  topic.isTop = !topic.isTop;

  topic.save(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);
    }
  });
};

/**
 * toggleTopicGlobalStatus
 * @param req
 * @param res
 */
exports.toggleTopicGlobalStatus = function (req, res) {
  var topic = req.topic;

  if (!req.user.isOper && !req.user.isAdmin) {
    return res.status(403).json({
      message: 'SERVER.USER_IS_NOT_AUTHORIZED'
    });
  }

  topic.isGlobal = !topic.isGlobal;

  topic.save(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);
    }
  });
};

/**
 * toggleTopicHomeHelpStatus
 * @param req
 * @param res
 */
exports.toggleTopicHomeHelpStatus = function (req, res) {
  var topic = req.topic;

  if (!req.user.isOper && !req.user.isAdmin) {
    return res.status(403).json({
      message: 'SERVER.USER_IS_NOT_AUTHORIZED'
    });
  }

  topic.isHomeHelp = !topic.isHomeHelp;
  topic.pushHomeAt = Date.now();

  topic.save(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);
    }
  });
};

/**
 * toggleTopicHomeNoticeStatus
 * @param req
 * @param res
 */
exports.toggleTopicHomeNoticeStatus = function (req, res) {
  var topic = req.topic;

  if (!req.user.isOper && !req.user.isAdmin) {
    return res.status(403).json({
      message: 'SERVER.USER_IS_NOT_AUTHORIZED'
    });
  }

  topic.isHomeNotice = !topic.isHomeNotice;
  topic.pushHomeAt = Date.now();

  topic.save(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);
    }
  });
};

/**
 * thumbsUp
 * @param req
 * @param res
 */
exports.thumbsUp = function (req, res) {
  var user = req.user;
  var exist = false;
  var topic = req.topic;
  var replyUid = undefined;
  var thumb = new Thumb();
  thumb.user = req.user;
  thumb.score = scoreConfig.action.thumbsUpScoreOfTopicTo.value;

  if (req.query.replyId) {
    topic._replies.forEach(function (r) {
      if (r._id.equals(req.query.replyId)) {
        //check if already exist
        exist = false;
        replyUid = r.user._id;
        r._thumbs.forEach(function (sr) {
          if (sr.user._id.equals(req.user._id)) {
            exist = true;
          }
        });
        if (exist) {
          return res.status(422).send({
            message: 'SERVER.ALREADY_THUMBS_UP'
          });
        } else {
          if (req.user.score >= thumb.score) {
            r._thumbs.push(thumb);
            save();

            //score update
            //score update
            var act = scoreConfig.action.thumbsUpScoreOfTopicTo;
            act.params = {
              fid: topic.forum,
              tid: topic._id
            };
            scoreUpdate(req, r.user, act);

            //add server message
            if (serverNoticeConfig.action.forumReplyThumbsUp.enable) {
              serverMessage.addMessage(replyUid, serverNoticeConfig.action.forumReplyThumbsUp.title, serverNoticeConfig.action.forumReplyThumbsUp.content, {
                topic_title: topic.title,
                forum_id: topic.forum,
                topic_id: topic._id,
                reply_id: req.query.replyId,
                by_name: user.displayName,
                by_id: user._id
              });
            }
          } else {
            return res.status(422).send({
              message: 'SERVER.SCORE_NOT_ENOUGH'
            });
          }
        }
      }
    });
  } else {
    //check if already exist
    exist = false;
    topic._thumbs.forEach(function (sr) {
      if (sr.user._id.equals(req.user._id)) {
        exist = true;
      }
    });
    if (exist) {
      return res.status(422).send({
        message: 'SERVER.ALREADY_THUMBS_UP'
      });
    } else {
      if (req.user.score >= thumb.score) {
        topic._thumbs.push(thumb);
        save();

        //score update
        var act = scoreConfig.action.thumbsUpScoreOfTopicTo;
        act.params = {
          fid: topic.forum,
          tid: topic._id
        };
        scoreUpdate(req, topic.user, act);

        //add server message
        if (serverNoticeConfig.action.forumTopicThumbsUp.enable) {
          serverMessage.addMessage(topic.user._id, serverNoticeConfig.action.forumTopicThumbsUp.title, serverNoticeConfig.action.forumTopicThumbsUp.content, {
            topic_title: topic.title,
            forum_id: topic.forum,
            topic_id: topic._id,
            by_name: user.displayName,
            by_id: user._id
          });
        }
      } else {
        return res.status(422).send({
          message: 'SERVER.SCORE_NOT_ENOUGH'
        });
      }
    }
  }

  function save() {
    topic.save(function (err) {
      if (err) {
        return res.status(422).send({
          message: errorHandler.getErrorMessage(err)
        });
      } else {
        res.json(topic);
      }
    });

    //score update
    var act = scoreConfig.action.thumbsUpScoreOfTopicFrom;
    act.params = {
      fid: topic.forum,
      tid: topic._id
    };
    scoreUpdate(req, user, act);
  }
};

/**
 * deleteTopic
 * @param req
 * @param res
 */
exports.deleteTopic = function (req, res) {
  var forum = req.forum;
  var topic = req.topic;
  var rcount = topic.replyCount;

  if (!canEdit(req.user, forum) && !isOwner(req.user, topic)) {
    return res.status(403).json({
      message: 'SERVER.USER_IS_NOT_AUTHORIZED'
    });
  }

  topic._replies.forEach(function (r) {
    r.user.update({
      $inc: {replies: -1}
    }).exec();
  });

  topic.remove(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);

      Topic.findOne({
        forum: forum._id
      })
        .sort('-lastReplyAt -createdAt')
        .exec(function (err, topic) {
          if (!err) {
            forum.update({
              $inc: {topicCount: -1, replyCount: -rcount},
              lastTopic: topic
            }).exec();
          }
        });

      topic.user.update({
        $inc: {topics: -1}
      }).exec();

      //add server message
      if (serverNoticeConfig.action.forumTopicDeleted.enable && !topic.user._id.equals(req.user._id)) {
        serverMessage.addMessage(topic.user._id, serverNoticeConfig.action.forumTopicDeleted.title, serverNoticeConfig.action.forumTopicDeleted.content, {
          topic_title: topic.title,
          forum_id: topic.forum,
          topic_id: topic._id,
          by_name: req.user.displayName,
          by_id: req.user._id
        });
      }

      //create trace log
      traceLogCreate(req, traceConfig.action.forumDeleteTopic, {
        forum: forum._id,
        topic: topic._id
      });
    }
  });
};

/**
 * postNewReply
 * @param req
 * @param res
 */
exports.postNewReply = function (req, res) {
  var user = req.user;
  var forum = req.forum;
  var topic = req.topic;
  var reply = new Reply(req.body);
  reply.user = req.user;

  //replace content path
  var regex = new RegExp('/modules/forums/client/attach/temp/', 'g');
  reply.content = reply.content.replace(regex, '/modules/forums/client/attach/');

  topic._replies.push(reply);
  topic.replyCount++;
  topic.lastReplyAt = Date.now();
  topic.lastUser = req.user;

  //move temp torrent file to dest directory
  req.body._uImage.forEach(function (f) {
    var oldPath = config.uploads.attach.file.temp + f.filename;
    var newPath = config.uploads.attach.file.dest + f.filename;
    move(oldPath, newPath, function (err) {
      if (err) {
        mtDebug.debugRed(err);
      }
    });
  });
  req.body._attach.forEach(function (f) {
    var oldPath = config.uploads.attach.file.temp + f.filename;
    var newPath = config.uploads.attach.file.dest + f.filename;
    move(oldPath, newPath, function (err) {
      if (err) {
        mtDebug.debugRed(err);
      }
    });
  });

  //save topic
  topic.save(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);

      user.update({
        $inc: {replies: 1}
      }).exec();

      forum.update({
        $inc: {replyCount: 1},
        lastTopic: topic
      }).exec();

      //add server message
      if (serverNoticeConfig.action.forumTopicNewReply.enable && !topic.user._id.equals(user._id)) {
        serverMessage.addMessage(topic.user._id, serverNoticeConfig.action.forumTopicNewReply.title, serverNoticeConfig.action.forumTopicNewReply.content, {
          topic_title: topic.title,
          forum_id: topic.forum,
          topic_id: topic._id,
          reply_id: reply._id,
          by_name: user.displayName,
          by_id: user._id
        });
      }
    }
  });
};

/**
 * updateReply
 * @param req
 * @param res
 */
exports.updateReply = function (req, res) {
  var forum = req.forum;
  var topic = req.topic;

  topic._replies.forEach(function (r) {
    if (r._id.equals(req.params.replyId)) {

      if (!canEdit(req.user, forum) && !isOwner(req.user, r)) {
        return res.status(403).json({
          message: 'SERVER.USER_IS_NOT_AUTHORIZED'
        });
      }

      r.content = req.body.content;
      r.updatedAt = Date.now();
      r.updatedBy = req.user;

      topic.save(function (err) {
        if (err) {
          return res.status(422).send({
            message: errorHandler.getErrorMessage(err)
          });
        } else {
          res.json(topic);
        }
      });
    }
  });
};

/**
 * deleteReply
 * @param req
 * @param res
 */
exports.deleteReply = function (req, res) {
  var forum = req.forum;
  var topic = req.topic;
  var replyUid = undefined;

  topic._replies.forEach(function (r) {
    if (r._id.equals(req.params.replyId)) {

      if (!canEdit(req.user, forum) && !isOwner(req.user, r)) {
        return res.status(403).json({
          message: 'SERVER.USER_IS_NOT_AUTHORIZED'
        });
      }

      replyUid = r.user._id;
      topic._replies.pull(r);
      topic.replyCount--;

      var lastReply = topic._replies[topic._replies.length - 1];
      if (lastReply === r) {
        lastReply = topic._replies[topic._replies.length - 2];
      }
      if (lastReply) {
        topic.lastReplyAt = lastReply.createdAt;
        topic.lastUser = lastReply.user;
      } else {
        topic.lastReplyAt = undefined;
        topic.lastUser = undefined;
      }

      topic.save(function (err) {
        if (err) {
          return res.status(422).send({
            message: errorHandler.getErrorMessage(err)
          });
        } else {
          res.json(topic);

          r.user.update({
            $inc: {replies: -1}
          }).exec();

          forum.update({
            $inc: {replyCount: -1}
          }).exec();

          Topic.findOne({
            forum: forum._id
          })
            .sort('-lastReplyAt -createdAt')
            .exec(function (err, topic) {
              if (!err) {
                forum.update({
                  lastTopic: topic
                }).exec();
              }
            });

          //add server message
          if (serverNoticeConfig.action.forumReplyDeleted.enable && !replyUid.equals(req.user._id)) {
            serverMessage.addMessage(replyUid, serverNoticeConfig.action.forumReplyDeleted.title, serverNoticeConfig.action.forumReplyDeleted.content, {
              topic_title: topic.title,
              forum_id: topic.forum,
              topic_id: topic._id,
              reply_id: req.params.replyId,
              by_name: req.user.displayName,
              by_id: req.user._id
            });
          }

          //create trace log
          traceLogCreate(req, traceConfig.action.forumDeleteReply, {
            forum: forum._id,
            topic: topic._id,
            reply: req.params.replyId
          });
        }
      });
    }
  });
};

/**
 * attachUpload
 * @param req
 * @param res
 */
exports.attachUpload = function (req, res) {
  var user = req.user;
  var createUploadAttachFilename = require(path.resolve('./config/lib/multer')).createUploadAttachFilename;
  var getUploadAttachDestination = require(path.resolve('./config/lib/multer')).getUploadAttachDestination;
  var attachInfo = {};

  var storage = multer.diskStorage({
    destination: getUploadAttachDestination,
    filename: createUploadAttachFilename
  });

  var upload = multer({
    storage: storage,
    //fileFilter: fileFilter,
    limits: config.uploads.attach.file.limits
  }).single('newAttachFile');

  if (user) {
    uploadFile()
      .then(function () {
        res.status(200).send(attachInfo);
      })
      .catch(function (err) {
        res.status(422).send(err);
        mtDebug.debugRed(err);

        if (req.file && req.file.filename) {
          var newfile = config.uploads.attach.file.temp + req.file.filename;
          if (fs.existsSync(newfile)) {
            mtDebug.debugRed(err);
            mtDebug.debugRed('ERROR: DELETE TEMP ATTACH FILE: ' + newfile);
            fs.unlinkSync(newfile);
          }
        }
      });
  } else {
    res.status(401).send({
      message: 'User is not signed in'
    });
  }

  function uploadFile() {
    return new Promise(function (resolve, reject) {
      upload(req, res, function (uploadError) {
        if (uploadError) {
          var message = errorHandler.getErrorMessage(uploadError);

          if (uploadError.code === 'LIMIT_FILE_SIZE') {
            message = 'Attach file too large. Maximum size allowed is ' + (config.uploads.attach.file.limits.fileSize / (1024 * 1024)).toFixed(2) + ' Mb files.';
          }

          reject(message);
        } else {
          attachInfo.filename = req.file.filename;
          resolve();
        }
      });
    });
  }
};

/**
 * attachDownload
 * @param req
 * @param res
 */
exports.attachDownload = function (req, res) {
  var topic = req.topic;
  var filePath = undefined;
  var fileName = undefined;

  if (req.params.replyId) {
    topic._replies.forEach(function (rep) {
      if (rep._id.equals(req.params.replyId)) {
        rep._attach.forEach(function (at) {
          if (at._id.equals(req.query.attachId)) {
            at.downCount++;
            filePath = config.uploads.attach.file.dest + at.filename;
            fileName = at.filename;

            topic.markModified('_replies');
            topic.save();
          }
        });
      }
    });
  } else {
    topic._attach.forEach(function (at) {
      if (at._id.equals(req.query.attachId)) {
        at.downCount++;
        filePath = config.uploads.attach.file.dest + at.filename;
        fileName = at.filename;

        topic.save();
      }
    });
  }
  return downFile(filePath, fileName);

  function downFile(filePath, filename) {
    if (!filePath) {
      res.status(422).send({
        message: 'FILE_DOES_NOT_FINDED'
      });
    }

    fs.exists(filePath, function (exists) {
      if (exists) {
        var stat = fs.statSync(filePath);

        try {
          //res.set('Content-Type', 'application/x-bittorrent');
          res.set('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(filename));
          res.set('Content-Length', stat.size);

          fs.createReadStream(filePath).pipe(res);
        } catch (err) {
          res.status(422).send({
            message: 'DOWNLOAD_FAILED'
          });
        }
      } else {
        res.status(422).send({
          message: 'FILE_DOES_NOT_EXISTS'
        });
      }
    });
  }
};

/**
 * Invitation middleware
 */
exports.topicById = function (req, res, next, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).send({
      message: 'SERVER.INVALID_OBJECTID'
    });
  }

  Topic.findById(id)
    .populate('user', 'username displayName profileImageURL isVip score uploaded downloaded signature')
    .populate('lastUser', 'username displayName profileImageURL isVip score uploaded downloaded')
    .populate('updatedBy', 'username displayName profileImageURL isVip score uploaded downloaded')
    .populate('_thumbs.user', 'username displayName profileImageURL isVip score uploaded downloaded')
    .populate('_replies.user', 'username displayName profileImageURL isVip score uploaded downloaded signature')
    .populate('_replies.updatedBy', 'username displayName profileImageURL isVip score uploaded downloaded')
    .populate('_replies._thumbs.user', 'username displayName profileImageURL isVip score uploaded downloaded')
    .exec(function (err, topic) {
      if (err) {
        return next(err);
      } else if (!topic) {
        return res.status(404).send();
      }
      req.topic = topic;
      next();
    });
};

/**
 * canEdit
 * @param u, req.user
 * @param f, forum
 * @returns {boolean}
 */
function canEdit(u, f) {
  if (u.isOper) {
    return true;
  } else if (u.isAdmin) {
    return true;
  } else if (isModerator(f)) {
    return true;
  } else {
    return false;
  }

  function isModerator(f) {
    if (f) {
      var isM = false;
      f.moderators.forEach(function (m) {
        if (m._id.equals(u._id)) {
          isM = true;
        }
      });
      return isM;
    } else {
      return false;
    }
  }
}

/**
 * isOwner
 * @param o, topic or reply object
 * @returns {boolean}
 */
function isOwner(u, o) {
  if (o) {
    if (o.user._id.equals(u._id)) {
      return true;
    } else {
      return false;
    }
  } else {
    return false;
  }
}
