'use strict';

/**
 * Module dependencies
 */
var path = require('path'),
  config = require(path.resolve('./config/config')),
  common = require(path.resolve('./config/lib/common')),
  mongoose = require('mongoose'),
  errorHandler = require(path.resolve('./modules/core/server/controllers/errors.server.controller')),
  validator = require('validator'),
  nodemailer = require('nodemailer'),
  User = mongoose.model('User'),
  Invitation = mongoose.model('Invitation'),
  async = require('async'),
  scoreUpdate = require(path.resolve('./config/lib/score')).update,
  traceLogCreate = require(path.resolve('./config/lib/tracelog')).create;

var smtpTransport = nodemailer.createTransport(config.mailer.options);
var traceConfig = config.meanTorrentConfig.trace;
var mtDebug = require(path.resolve('./config/lib/debug'));
var inviteConfig = config.meanTorrentConfig.invite;
var scoreConfig = config.meanTorrentConfig.score;
var appConfig = config.meanTorrentConfig.app;

/**
 * A Validation function for local strategy email
 */
var validateEmail = function (email) {
  return validator.isEmail(email, {require_tld: false});
};

/**
 * create a Invitation
 * @param req
 * @param res
 */
exports.create = function (req, res) {
  var user = req.user;

  if (user.score >= inviteConfig.scoreExchange) {
    var invitation = new Invitation();
    invitation.expiresat = Date.now() + config.meanTorrentConfig.invite.expires;
    invitation.user = req.user;
    invitation.isOfficial = false;
    invitation.token = req.user.randomAsciiString(32);

    invitation.save(function (err) {
      if (err) {
        return res.status(422).send({
          message: errorHandler.getErrorMessage(err)
        });
      } else {
        user.score -= inviteConfig.scoreExchange;
        res.json(user);

        //score update
        scoreUpdate(req, user, scoreConfig.action.scoreExchangeInvitation, -(inviteConfig.scoreExchange));

        //create trace log
        traceLogCreate(req, traceConfig.action.userInvitationExchange, {
          user: req.user._id,
          token: invitation.token,
          score: inviteConfig.scoreExchange
        });
      }
    });
  } else {
    return res.status(422).send({
      message: 'SERVER.SCORE_NOT_ENOUGH'
    });
  }
};

/**
 * listOfficial
 * @param req
 * @param res
 */
exports.listOfficial = function (req, res) {
  Invitation.find({
    isOfficial: true
  })
    .sort('-invitedat')
    .populate('user', '-salt -password')
    .populate('to_user', '-salt -password')
    .exec(function (err, invitations) {
      if (err) {
        return res.status(422).send({
          message: errorHandler.getErrorMessage(err)
        });
      } else {
        res.json(invitations);
      }
    });

};

/**
 * deleteExpiredOfficialInvitation
 * @param req
 * @param res
 */
exports.deleteExpiredOfficialInvitation = function (req, res) {
  Invitation.remove({
    isOfficial: true,
    status: 1,
    expiresat: {$lt: Date.now()}
  }, function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json({
        message: 'SERVER.DELETE_EXPIRED_OFFICIAL_INVITATION_OK'
      });
    }
  });

};

/**
 * List of Invitations
 */
exports.list = function (req, res) {
  var findMyInvitations = function (callback) {
    Invitation.find({
      user: req.user._id,
      status: 0,
      expiresat: {$gt: Date.now()}
    })
      .sort('createdat')
      .populate('user', '-salt -password -followers -following -leeched_ip -signed_ip -signature')
      .exec(function (err, invitations) {
        if (err) {
          callback(err, null);
        } else {
          callback(null, invitations);
        }
      });
  };

  var findUsedInvitations = function (callback) {
    Invitation.find({
      user: req.user._id,
      status: {$gt: 0}
    })
      .sort('invitedat')
      .populate('user', '-salt -password -followers -following -leeched_ip -signed_ip -signature')
      .populate('to_user', '-salt -password -followers -following -leeched_ip -signed_ip -signature')
      .exec(function (err, invitations) {
        if (err) {
          callback(err, null);
        } else {
          callback(null, invitations);
        }
      });
  };

  async.parallel([findMyInvitations, findUsedInvitations], function (err, results) {
    if (err) {
      return res.status(422).send(err);
    } else {
      res.json({
        my_invitations: results[0],
        used_invitations: results[1]
      });
    }
  });
};

/**
 * Update an invitation
 */
exports.update = function (req, res) {
  var invitation = req.invitation;

  var countRegisteredEmail = function (callback) {
    User.count({email: req.query.to_email}, function (err, count) {
      if (err) {
        callback(err, null);
      } else {
        callback(null, count);
      }
    });
  };
  var countInvitedEmail = function (callback) {
    Invitation.count({to_email: req.query.to_email}, function (err, count) {
      if (err) {
        callback(err, null);
      } else {
        callback(null, count);
      }
    });
  };

  async.parallel([countRegisteredEmail, countInvitedEmail], function (err, results) {
    if (err) {
      return res.status(422).send(err);
    } else {
      if (results[0] > 0) {
        return res.status(422).send({message: 'SERVER.EMAIL_ALREADY_REGISTERED'});
      } else if (results[1] > 0) {
        return res.status(422).send({message: 'SERVER.EMAIL_ALREADY_INVITED'});
      } else if (!common.emailIsAllowable(req.query.to_email)) {
        return res.status(422).send({message: 'SERVER.EMAIL_ADDRESS_IS_NOT_ALLOW'});
      } else {
        //send invitation mail
        var lang = common.getRequestLanguage(req);
        res.render(path.resolve('modules/invitations/server/templates/invite-sign-up-email-' + lang), {
          to_email: req.query.to_email,
          name: req.user.displayName,
          appName: config.app.title,
          url: appConfig.domain + '/api/auth/invite/' + invitation.token,
          hours: config.meanTorrentConfig.invite.expires / (60 * 60 * 1000)
        }, function (err, emailHTML) {
          if (err) {
            return res.status(422).send({message: 'SERVER.INVITE_MAIL_RENDER_FAILED'});
          } else {
            var mailOptions = {
              to: req.query.to_email,
              from: config.mailer.from,
              subject: config.app.title + ' - Invitation is here!',
              html: emailHTML
            };
            smtpTransport.sendMail(mailOptions, function (err) {
              if (err) {
                return res.status(422).send({message: 'SERVER.INVITE_MAIL_SEND_FAILED'});
              } else {
                invitation.to_email = req.query.to_email;
                invitation.status = 1;
                invitation.invitedat = Date.now();
                invitation.expiresat = Date.now() + config.meanTorrentConfig.invite.expires;

                invitation.save(function (err) {
                  if (err) {
                    return res.status(422).send({
                      message: errorHandler.getErrorMessage(err)
                    });
                  } else {
                    res.json(invitation);
                    //create trace log
                    traceLogCreate(req, traceConfig.action.userSendInvitation, {
                      to: req.query.to_email,
                      token: invitation.token
                    });
                  }
                });
              }
            });
          }
        });
      }
    }
  });
};

/**
 * sendOfficial
 * send official invitation
 * @param req
 * @param res
 */
exports.sendOfficial = function (req, res) {
  if (!validateEmail(req.body.email)) {
    return res.status(422).send({
      message: 'ERROR: invalid email address!'
    });
  } else {

    var countRegisteredEmail = function (callback) {
      User.count({email: req.body.email}, function (err, count) {
        if (err) {
          callback(err, null);
        } else {
          callback(null, count);
        }
      });
    };
    var countInvitedEmail = function (callback) {
      Invitation.count({to_email: req.body.email}, function (err, count) {
        if (err) {
          callback(err, null);
        } else {
          callback(null, count);
        }
      });
    };

    async.parallel([countRegisteredEmail, countInvitedEmail], function (err, results) {
      if (err) {
        return res.status(422).send(err);
      } else {
        if (results[0] > 0) {
          return res.status(422).send({message: 'SERVER.EMAIL_ALREADY_REGISTERED'});
        } else if (results[1] > 0) {
          return res.status(422).send({message: 'SERVER.EMAIL_ALREADY_INVITED'});
        } else if (!common.emailIsAllowable(req.body.email)) {
          return res.status(422).send({message: 'SERVER.EMAIL_ADDRESS_IS_NOT_ALLOW'});
        } else {
          //write invitation data
          var invitation = new Invitation();
          invitation.user = req.user;
          invitation.token = req.user.randomAsciiString(32);
          invitation.to_email = req.body.email;
          invitation.status = 1;
          invitation.invitedat = Date.now();
          invitation.expiresat = Date.now() + config.meanTorrentConfig.invite.expires;
          invitation.isOfficial = true;
          invitation.type = 'official';

          //send invitation mail
          var lang = common.getRequestLanguage(req);
          res.render(path.resolve('modules/invitations/server/templates/invite-sign-up-email-' + lang), {
            to_email: req.body.email,
            name: req.user.displayName,
            appName: config.app.title,
            url: appConfig.domain + '/api/auth/invite/' + invitation.token,
            hours: config.meanTorrentConfig.invite.expires / (60 * 60 * 1000)
          }, function (err, emailHTML) {
            if (err) {
              return res.status(422).send({message: 'SERVER.INVITE_MAIL_RENDER_FAILED'});
            } else {
              var mailOptions = {
                to: req.body.email,
                from: config.mailer.from,
                subject: config.app.title + ' - Official invitation is here!',
                html: emailHTML
              };
              smtpTransport.sendMail(mailOptions, function (err) {
                if (err) {
                  return res.status(422).send({message: 'SERVER.INVITE_MAIL_SEND_FAILED'});
                } else {
                  //save invitation data
                  invitation.save(function (err) {
                    if (err) {
                      return res.status(422).send({
                        message: errorHandler.getErrorMessage(err)
                      });
                    } else {
                      res.json(invitation);

                      //create trace log
                      traceLogCreate(req, traceConfig.action.adminSendOfficialInvitation, {
                        to: req.body.email,
                        token: invitation.token
                      });
                    }
                  });
                }
              });
            }
          });
        }
      }
    });
  }
};

/**
 * Delete an invitation
 */
exports.delete = function (req, res) {
  var invitation = req.invitation;

  invitation.remove(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(invitation);
    }
  });
};

/**
 * verifyToken
 * @param req
 * @param res
 */
exports.verifyToken = function (req, res) {
  var t = req.params.token;

  Invitation.findOne({token: t}).exec(function (err, invitation) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else if (!invitation) {
      return res.status(404).send({
        message: 'No invitation with that token has been found'
      });
    }
    res.json(invitation);
  });

};

/**
 * countInvitations
 * @param req
 * @param res
 */
exports.countInvitations = function (req, res) {
  var countMyInvitations = function (callback) {
    Invitation.count({
      user: req.user._id,
      status: 0,
      expiresat: {$gt: Date.now()}
    }, function (err, count) {
      if (err) {
        callback(err, null);
      } else {
        callback(null, count);
      }
    });
  };
  var countUsedInvitations = function (callback) {
    Invitation.count({
      user: req.user._id,
      status: 2
    }, function (err, count) {
      if (err) {
        callback(err, null);
      } else {
        callback(null, count);
      }
    });
  };

  async.parallel([countMyInvitations, countUsedInvitations], function (err, results) {
    if (err) {
      return res.status(422).send(err);
    } else {
      res.json({
        countMyInvitations: results[0],
        countUsedInvitations: results[1]
      });
    }
  });
};

/**
 * Invitation middleware
 */
exports.invitationByID = function (req, res, next, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).send({
      message: 'SERVER.INVALID_OBJECTID'
    });
  }

  Invitation.findById(id).populate('user', '-salt -password').exec(function (err, invitation) {
    if (err) {
      return next(err);
    } else if (!invitation) {
      return res.status(404).send();
    }
    req.invitation = invitation;
    next();
  });
};

