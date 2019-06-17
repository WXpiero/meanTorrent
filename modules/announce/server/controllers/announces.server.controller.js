'use strict';

/**
 * Module dependencies
 */
var path = require('path'),
  config = require(path.resolve('./config/config')),
  common = require(path.resolve('./config/lib/common')),
  dataLog = require(path.resolve('./config/lib/data-log')),
  mongoose = require('mongoose'),
  User = mongoose.model('User'),
  Torrent = mongoose.model('Torrent'),
  Peer = mongoose.model('Peer'),
  Complete = mongoose.model('Complete'),
  Finished = mongoose.model('Finished'),
  bcode = require(path.resolve('./config/lib/bencode')),
  benc = require('bncode'),
  ipRegex = require('ip-regex'),
  moment = require('moment'),
  async = require('async'),
  sprintf = require('sprintf-js').sprintf,
  traceLogCreate = require(path.resolve('./config/lib/tracelog')).create,
  scoreUpdate = require(path.resolve('./config/lib/score')).update;

var traceConfig = config.meanTorrentConfig.trace;
var scoreConfig = config.meanTorrentConfig.score;
var hnrConfig = config.meanTorrentConfig.hitAndRun;
var announceConfig = config.meanTorrentConfig.announce;
var globalSalesConfig = config.meanTorrentConfig.torrentGlobalSales;

var appConfig = config.meanTorrentConfig.app;

var mtDebug = require(path.resolve('./config/lib/debug'));

const FAILURE_REASONS = {
  100: 'Invalid request type: client request was not a HTTP GET',
  101: 'Missing info_hash',
  102: 'Missing peer_id',
  103: 'Missing port',
  104: 'Missing passkey',

  150: 'Invalid infohash: infohash is not 20 bytes long',
  151: 'Invalid peerid: peerid is not 20 bytes long',
  152: 'Invalid numwant. Client requested more peers than allowed by tracker',
  153: 'Passkey length error (length=32)',
  154: 'Invalid passkey, if you changed you passkey, please redownload the torrent file from ' + appConfig.domain,

  160: 'Invalid torrent info_hash',
  161: 'No torrent with that info_hash has been found',

  170: 'your account status is banned',
  171: 'your account status is inactive',
  172: 'your client is not allowed, here is the blacklist: ' + appConfig.domain + announceConfig.clientBlackListUrl,
  173: 'this torrent status is not reviewed by administrators, try again later',
  174: 'this torrent is only for VIP members',
  175: 'your account status is idle',
  176: 'you can not seeding an un-download finished torrent',

  180: 'You can not open more than 1 downloading processes on the same torrent',
  181: 'You can not open more than 3 seeding processes on the same torrent',
  182: 'save peer failed',
  183: 'save torrent failed',
  184: 'save passkeyuser failed',
  185: 'get H&R completeTorrent failed',
  186: 'create H&R completeTorrent failed',
  187: 'Illegal completed event',

  190: 'You have more H&R warning, can not download any torrent now!',
  191: 'not find this torrent H&R complete data',

  200: 'Your total ratio is less than %.2f, can not download anything',

  600: 'This tracker only supports compact mode',
  900: 'Generic error'
};

const EVENT_NONE = 0;
const EVENT_COMPLETED = 1;
const EVENT_STARTED = 2;
const EVENT_STOPPED = 3;

const WANT_DEFAULT = 50;

const PEERSTATE_SEEDER = 'seeder';
const PEERSTATE_LEECHER = 'leecher';

const PEER_COMPACT_SIZE = 6;
const ANNOUNCE_INTERVAL = Math.floor(announceConfig.announceInterval / 1000);

const PARAMS_INTEGER = [
  'port', 'uploaded', 'downloaded', 'left', 'compact', 'numwant', 'no_peer_id'
];

const PARAMS_STRING = [
  'event',
  'ipv4',
  'ipv6'
];

var isGlobalSaleValid = false;

/**
 * event
 * @param e
 * @returns {number}
 */
function event(e) {
  switch (e) {
    case 'completed':
      return EVENT_COMPLETED;
    case 'started':
      return EVENT_STARTED;
    case 'stopped':
      return EVENT_STOPPED;
  }
  return EVENT_NONE;
}

/**
 * eventString
 * @param e
 * @returns {number}
 */
function eventString(e) {
  switch (e) {
    case 'completed':
      return 'EVENT_COMPLETED';
    case 'started':
      return 'EVENT_STARTED';
    case 'stopped':
      return 'EVENT_STOPPED';
  }
  return 'EVENT_NONE';
}

/**
 * Failure
 * @param code
 * @param reason
 * @constructor
 */
function Failure(code, reason) {
  this.code = code;
  this.reason = reason;
  if (reason === undefined && typeof FAILURE_REASONS[this.code] !== 'undefined')
    this.reason = FAILURE_REASONS[this.code];
  else if (this.code == null)
    this.code = 900;
}

/**
 * Failure.prototype
 * @type {{bencode: Function}}
 */
Failure.prototype = {
  bencode: function () {
    return 'd14:failure reason' + this.reason.length + ':' + this.reason + '12:failure codei' + this.code + 'ee';
  }
};

/**
 * info api
 * @param req
 * @param res
 */
exports.announce = function (req, res) {
  req.torrent = undefined;
  req.currentPeer = undefined;
  req.completeTorrent = undefined;
  req.selfpeer = [];
  req.seeder = false;

  mtDebug.debugGreen('\n\n', 'ANNOUNCE', true, req.passkeyuser);
  mtDebug.debugGreen('================================================================================', 'ANNOUNCE', true, req.passkeyuser);
  mtDebug.debugGreen('                                  ANNOUNCE REQUEST                              ', 'ANNOUNCE', true, req.passkeyuser);
  mtDebug.debugGreen('================================================================================', 'ANNOUNCE', true, req.passkeyuser);
  mtDebug.debugBlue(req.url, 'ANNOUNCE', true, req.passkeyuser);

  var s = req.url.split('?');
  var query = common.querystringParse(s[1]);
  var passkey = req.params.passkey || query.passkey || undefined;

  async.waterfall([
    /*---------------------------------------------------------------
     validateQueryCheck
     ---------------------------------------------------------------*/
    function (done) {
      var i = 0;
      var p;

      if (req.method !== 'GET') {
        done(100);
      } else if (typeof query.info_hash === 'undefined') {
        done(101);
      } else if (typeof query.peer_id === 'undefined') {
        done(102);
      } else if (typeof query.port === 'undefined') {
        done(103);
      } else if (query.info_hash.length !== 20) {
        done(150);
      } else if (query.peer_id.length !== 20) {
        done(151);
      } else if (typeof query.compact === 'undefined' || query.compact !== '1') {
        query.compact = 0;
      } else {
        for (i = 0; i < PARAMS_INTEGER.length; i++) {
          p = PARAMS_INTEGER[i];
          if (typeof query[p] !== 'undefined') {
            query[p] = parseInt(query[p].toString(), 10);
          }
        }

        for (i = 0; i < PARAMS_STRING.length; i++) {
          p = PARAMS_STRING[i];
          if (typeof query[p] !== 'undefined') {
            query[p] = query[p].toString();
          }
        }

        if (query.ipv4 === undefined) {
          query.ipv4 = '';
        }
        if (query.ipv6 === undefined) {
          query.ipv6 = '';
        }
        if (query.ipv6.toLowerCase().startsWith('fe80')) {
          query.ipv6 = '';
        }

        //write ip v4 v6
        query.ip = req.cf_ip;
        if (ipRegex.v6({exact: true}).test(query.ip)) {
          query.ipv6 = query.ip;
        } else {
          query.ipv4 = query.ip;
        }

        query.info_hash = common.binaryToHex(query.info_hash);
        req.seeder = (query.left === 0) ? true : false;

        // console.log(query);

        done(null);
      }
    },

    /*---------------------------------------------------------------
     validatePasskeyCheck
     ---------------------------------------------------------------*/
    function (done) {
      if (typeof passkey === 'undefined') {
        done(104);
      } else if (passkey.length !== 32) {
        done(153);
      } else if (req.passkeyuser === undefined) {
        done(154);
      } else {
        done(null);
      }
    },

    /*---------------------------------------------------------------
     validateUserCheck
     check normal, banned, idle, inactive
     ---------------------------------------------------------------*/
    function (done) {
      switch (req.passkeyuser.status) {
        case 'banned':
          done(170);
          break;
        case 'idle':
          done(175);
          break;
        case 'inactive':
          done(171);
          break;
        default:
          done(null);
      }
    },

    /*---------------------------------------------------------------
     validateClientCheck
     check client blacklist
     ---------------------------------------------------------------*/
    function (done) {
      var ua = req.get('User-Agent');
      var inlist = false;
      if (ua) {
        config.meanTorrentConfig.clientBlackList.forEach(function (client) {
          if (ua.toUpperCase().indexOf(client.name.toUpperCase()) >= 0) {
            inlist = true;
          }
        });
      }
      if (inlist) {
        done(172);
      } else {
        done(null);
      }
    },

    /*---------------------------------------------------------------
     getTorrentItemData
     torrent data include peers
     ---------------------------------------------------------------*/
    function (done) {
      mtDebug.debugRed('req.passkeyuser._id     = ' + req.passkeyuser._id.toString(), 'ANNOUNCE', true, req.passkeyuser);
      mtDebug.debugRed('req.torrent.info_hash   = ' + query.info_hash, 'ANNOUNCE', true, req.passkeyuser);
      Torrent.findOne({
        info_hash: query.info_hash
      })
        .populate('user')
        .populate({
          path: '_peers'
        })
        .exec(function (err, t) {
          if (err) {
            done(160);
          } else if (!t) {
            done(161);
          } else if (t.torrent_status === 'new' && !req.seeder) {
            done(173);
          } else {
            req.torrent = t;
            done(null);
          }
        });
    },

    /*---------------------------------------------------------------
     refresh user`s vip status and ratio
     update torrent isSaling status
     ---------------------------------------------------------------*/
    function (done) {
      req.passkeyuser.globalUpdateMethod(function (u) {
        req.passkeyuser = u;

        if (req.torrent.isSaling) {
          req.torrent.globalUpdateMethod(function (t) {
            req.torrent = t;
            done(null);
          });
        } else {
          done(null);
        }
      });
    },

    /*---------------------------------------------------------------
     check torrent_vip and user_vip status
     ---------------------------------------------------------------*/
    function (done) {
      if (!req.seeder && req.torrent.torrent_vip && !req.passkeyuser.isVip) {
        done(174);
      } else {
        done(null);
      }
    },

    /*---------------------------------------------------------------
     check whether can seeding
     if torrent is not exist in user`s finished list
     ---------------------------------------------------------------*/
    function (done) {
      mtDebug.debugGreen('---------------' + eventString(query.event) + '----------------', 'ANNOUNCE', true, req.passkeyuser);
      if (req.seeder && event(query.event) !== EVENT_COMPLETED && event(query.event) !== EVENT_STOPPED) {
        if (announceConfig.seedingInFinishedCheck) {
          if (!req.passkeyuser._id.equals(req.torrent.user._id)) {
            Finished.findOne({
              user: req.passkeyuser._id,
              torrent: req.torrent._id
            }).exec(function (err, fini) {
              if (!fini) {
                done(176);
              } else {
                done(null);
              }
            });
          } else {
            done(null);
          }
        } else {
          done(null);
        }
      } else {
        done(null);
      }
    },

    /*---------------------------------------------------------------
     find complete torrent data
     if not find and torrent is h&r and user isn`t vip, then create complete record
     ---------------------------------------------------------------*/
    function (done) {
      if (hnrConfig.enable && req.torrent.torrent_hnr && !req.passkeyuser.isVip) {
        Complete.findOne({
          torrent: req.torrent._id,
          user: req.passkeyuser._id
        })
          .populate('user')
          .populate('torrent')
          .exec(function (err, t) {
            if (err) {
              done(185);
            } else {
              if (!t) {
                var comp = new Complete();
                comp.torrent = req.torrent;
                comp.user = req.passkeyuser;
                comp.complete = req.seeder ? true : false;

                comp.save(function (err) {
                  if (err) {
                    done(186);
                  } else {
                    req.completeTorrent = comp;
                    done(null);
                  }
                });
              } else {
                req.completeTorrent = t;
                done(null);
              }
            }
          });
      } else {
        done(null);
      }
    },

    /*---------------------------------------------------------------
     some time, when user close download client directly, maybe some ghost peer stay in peers table and not in torrent._peers
     delete them on start event of any user
     ----------------------------------------------------------------*/
    function (done) {
      if (event(query.event) === EVENT_STARTED) {
        Peer.remove({
          torrent: req.torrent._id,
          _id: {$nin: req.torrent._peers}
        }, function (err, removed) {
          if (removed.n > 0) {
            mtDebug.debugRed('Removed ' + removed + ' peers not in torrent._peers: ' + req.torrent._id, 'ANNOUNCE', true, req.passkeyuser);
          }
          done(null);
        });
      } else {
        done(null);
      }
    },

    /*---------------------------------------------------------------
     check N&R can download
     if user has too more H&R warning numbers, can not download any torrent
     but can continue download the warning status torrent
     vip user not checked
     ---------------------------------------------------------------*/
    function (done) {
      if (!req.seeder && !req.passkeyuser.isVip && event(query.event) === EVENT_STARTED) {
        if (hnrConfig.enable) {
          if (req.passkeyuser.hnr_warning >= hnrConfig.forbiddenDownloadMinWarningNumber) {
            if (!req.torrent.torrent_hnr) {
              done(190);
            } else {
              if (!req.completeTorrent) {
                done(191);
              } else {
                if (!req.completeTorrent.hnr_warning) {
                  done(190);
                } else {
                  done(null);
                }
              }
            }
          } else {
            done(null);
          }
        } else {
          done(null);
        }
      } else {
        done(null);
      }
    },

    /*---------------------------------------------------------------
     announce download check
     ratio check, setting in announce.downloadCheck
     vip user not checked
     ---------------------------------------------------------------*/
    function (done) {
      if (!req.seeder && !req.passkeyuser.isVip && !req.passkeyuser.isOper && event(query.event) === EVENT_STARTED) {
        if (req.passkeyuser.ratio !== -1 && req.passkeyuser.ratio < announceConfig.downloadCheck.ratio) {
          var checkTimeBegin = moment(req.passkeyuser.created).add(announceConfig.downloadCheck.checkAfterSignupDays, 'd');
          if (checkTimeBegin < moment(Date.now())) {
            var reason = sprintf(FAILURE_REASONS[200], announceConfig.downloadCheck.ratio);
            done(200, reason);
          } else {
            done(null);
          }
        } else {
          done(null);
        }
      } else {
        done(null);
      }
    },

    /*---------------------------------------------------------------
     find myself peers and get current peer with same peer_id
     ----------------------------------------------------------------*/
    function (done) {
      if (req.torrent._peers.length > 0) {
        for (var i = req.torrent._peers.length; i > 0; i--) {
          var p = req.torrent._peers[i - 1];
          if (p.user.equals(req.passkeyuser._id)) {
            if (p.last_announce_at > (Date.now() - announceConfig.announceInterval - announceConfig.announceIdleTime)) { //do not add inactive peer
              req.selfpeer.push(p);
            } else if (p.peer_id === query.peer_id) {
              req.selfpeer.push(p);
            }
          }
        }
      }

      getCurrentPeer(function () {
        mtDebug.debugRed('req.currentPeer.isNewCreated  = ' + req.currentPeer.isNewCreated, 'ANNOUNCE', true, req.passkeyuser);
        mtDebug.debugRed('req.currentPeer._id           = ' + req.currentPeer._id.toString(), 'ANNOUNCE', true, req.passkeyuser);
        mtDebug.debugRed('req.currentPeer.torrent._id   = ' + req.currentPeer.torrent._id, 'ANNOUNCE', true, req.passkeyuser);
        done(null);
      });
    },

    /*---------------------------------------------------------------
     onEventStarted
     if downloading, check download peer num only 1
     if seeding, check seed peer num can not more than 3
     numbers is in setting announceConfig.announceCheck
     ---------------------------------------------------------------*/
    function (done) {
      mtDebug.debugGreen('---------------CHECK USER SEED/LEECH COUNT----------------', 'ANNOUNCE', true, req.passkeyuser);
      var lcount = getSelfLeecherCount();
      var scount = getSelfSeederCount();

      if (lcount > announceConfig.announceCheck.maxLeechNumberPerUserPerTorrent && !req.seeder) {
        mtDebug.debugRed('getSelfLeecherCount   = ' + lcount, 'ANNOUNCE', true, req.passkeyuser);
        removeCurrPeer();
        done(180);
      } else if (scount > announceConfig.announceCheck.maxSeedNumberPerUserPerTorrent && req.seeder) {
        mtDebug.debugRed('getSelfSeederCount    = ' + scount, 'ANNOUNCE', true, req.passkeyuser);
        removeCurrPeer();
        done(181);
      } else {
        done(null);
      }
    },

    /*---------------------------------------------------------------
     writeUpDownData
     uploaded,downloaded
     update complete data if completeTorrent is exist
     if has upload and download data size, write data size,
     write time of seed(complete) whether or not u/d is 0
     ---------------------------------------------------------------*/
    function (done) {
      mtDebug.debugGreen('---------------WRITE_UP_DOWN_DATA----------------', 'ANNOUNCE', true, req.passkeyuser);

      var curru = 0;
      var currd = 0;

      if (!req.currentPeer.isNewCreated) {
        var udr = getUDRatio();

        curru = query.uploaded - req.currentPeer.peer_uploaded;
        currd = query.downloaded - req.currentPeer.peer_downloaded;

        if (curru > 0 || currd > 0) {
          var u = Math.round(curru * udr.ur);
          var d = Math.round(currd * udr.dr);

          //check if is vip
          if (req.passkeyuser.isVip) {
            u = u * globalSalesConfig.vip.value.Ur;
            d = d * globalSalesConfig.vip.value.Dr;
          }

          //check if is torrent uploader
          if (req.passkeyuser._id.equals(req.torrent.user._id)) {
            u = u * globalSalesConfig.uploader.value.Ur;
            d = d * globalSalesConfig.uploader.value.Dr;
          }

          //write user uploaded and downloaded
          var up_d = {
            uploaded: u,
            downloaded: d,
            true_uploaded: curru,
            true_downloaded: currd
          };
          mtDebug.debugRed(JSON.stringify(up_d), 'ANNOUNCE', true, req.passkeyuser);

          if (common.examinationIsValid(req.passkeyuser)) {
            up_d['examinationData.uploaded'] = u;
            up_d['examinationData.downloaded'] = d;
            mtDebug.debugGreen('---------------WRITE EXAMINATION DATA----------------', 'ANNOUNCE', true, req.passkeyuser);
            mtDebug.debugRed('examinationData.uploaded: ' + u + ', examinationData.downloaded: ' + d, 'ANNOUNCE', true, req.passkeyuser);
          }

          req.passkeyuser.update({
            $inc: up_d
          }).exec();

          //write peer speed
          var sp = {};
          if (curru > 0) {
            sp.peer_uspeed = Math.round(curru / (Date.now() - req.currentPeer.last_announce_at) * 1000);
            sp.peer_cuspeed = Math.round(curru / (Date.now() - req.currentPeer.last_announce_at) * 1000);
          } else {
            sp.peer_cuspeed = 0;
          }
          if (currd > 0) {
            sp.peer_dspeed = Math.round(currd / (Date.now() - req.currentPeer.last_announce_at) * 1000);
            sp.peer_cdspeed = Math.round(currd / (Date.now() - req.currentPeer.last_announce_at) * 1000);
          } else {
            sp.peer_cdspeed = 0;
          }
          req.currentPeer.update({
            $set: sp
          }).exec();

          //update score
          //upload score and download score
          var totalScore = 0;
          var upUnitScore = 1;
          var downUnitScore = 1;
          var seederUnit = 1;
          var lifeUnit = 1;

          var action = scoreConfig.action.seedUpDownload;
          var slAction = scoreConfig.action.seedSeederAndLife;

          if (action.enable) {
            var uploadScore = 0;
            var downloadScore = 0;

            if (curru > 0 && action.uploadEnable) {
              if (req.torrent.torrent_size > action.additionSize) {
                upUnitScore = Math.sqrt(req.torrent.torrent_size / action.additionSize);
              }
              var upScore = curru / action.perlSize;
              uploadScore = upUnitScore * action.uploadValue * upScore;
              //uploader addition
              if (req.passkeyuser._id.equals(req.torrent.user._id)) {
                uploadScore = uploadScore * action.uploaderRatio;
              }
            }

            if (currd > 0 && action.downloadEnable) {
              if (req.torrent.torrent_size > action.additionSize) {
                downUnitScore = Math.sqrt(req.torrent.torrent_size / action.additionSize);
              }
              var downScore = currd / action.perlSize;
              downloadScore = downUnitScore * action.downloadValue * downScore;
            }

            totalScore = uploadScore + downloadScore;
            if (totalScore > 0) {
              //vip addition
              if (action.vipRatio && req.passkeyuser.isVip) {
                totalScore = totalScore * action.vipRatio;
              }

              if (slAction.enable) {
                //torrent seeders count addition
                if (req.torrent.torrent_seeds <= slAction.seederCount) {
                  seederUnit = slAction.seederBasicRatio + slAction.seederCoefficient * (slAction.seederCount - req.torrent.torrent_seeds + 1);
                  totalScore = totalScore * seederUnit;
                }

                //torrent life addition
                var life = moment(Date.now()) - moment(req.torrent.createdat);
                var days = life / (60 * 60 * 1000 * 24);
                lifeUnit = slAction.lifeBasicRatio + slAction.lifeCoefficientOfDay * days;

                lifeUnit = lifeUnit > slAction.lifeMaxRatio ? slAction.lifeMaxRatio : lifeUnit;
                totalScore = totalScore * lifeUnit;
              }
              totalScore = Math.round(totalScore * 100) / 100;

              action.params = {
                tid: req.torrent._id
              };
              scoreUpdate(req, req.passkeyuser, action, totalScore, false);
              mtDebug.debugRed('announce score: ' + totalScore, 'ANNOUNCE', true, req.passkeyuser);
            }
          }

          //write logs data into db
          var logData = {
            query_uploaded: query.uploaded,
            query_downloaded: query.downloaded,
            currentPeer_uploaded: req.currentPeer.peer_uploaded,
            currentPeer_downloaded: req.currentPeer.peer_downloaded,

            curr_uploaded: curru,
            curr_downloaded: currd,
            write_uploaded: u,
            write_downloaded: d,
            write_score: totalScore,

            isVip: req.passkeyuser.isVip,
            isUploader: req.passkeyuser._id.equals(req.torrent.user._id),

            salesSettingValue: {
              torrentSalesValue: req.torrent.torrent_sale_status,
              globalSalesValue: isGlobalSaleValid ? globalSalesConfig.global.value : undefined,
              vipSalesValue: globalSalesConfig.vip.value,
              uploaderSalesValue: globalSalesConfig.uploader.value
            },
            scoreSettingValue: {
              upUnitScore: upUnitScore,
              downUnitScore: downUnitScore,
              seederUnit: seederUnit,
              lifeUnit: lifeUnit
            },
            info: {
              agent: req.get('User-Agent'),
              ip: req.cf_ip,
              port: query.port
            }
          };
          dataLog.announceLog(req.passkeyuser, req.torrent, logData);
        } else {
          req.currentPeer.update({
            $set: {
              peer_cuspeed: 0,
              peer_cdspeed: 0
            }
          }).exec();
        }
      }

      //write peer data
      req.currentPeer.update({
        $set: {
          peer_uploaded: query.uploaded,
          peer_downloaded: query.downloaded,
          peer_left: query.left
        }
      }).exec();

      done(null, curru, currd);
    },

    /*---------------------------------------------------------------
      write complete data to completeTorrent and refresh completed ratio
     ---------------------------------------------------------------*/
    function (curru, currd, done) {
      if (curru > 0 || currd > 0) {
        if (hnrConfig.enable && req.completeTorrent) {
          mtDebug.debugGreen('---------------WRITE COMPLETE DATA----------------', 'ANNOUNCE', true, req.passkeyuser);
          req.completeTorrent.update({
            $inc: {
              total_uploaded: curru,
              total_downloaded: currd
            }
          }, function () {
            done(null);
          });
        } else {
          done(null);
        }
      } else {
        done(null);
      }
    },

    /*---------------------------------------------------------------
     update H&R completeTorrent.total_seed_time
     update H&R ratio in save
     ---------------------------------------------------------------*/
    function (done) {
      if (!req.currentPeer.isNewCreated) {
        if (hnrConfig.enable && req.completeTorrent && req.completeTorrent.complete && event(query.event) !== EVENT_COMPLETED) {
          mtDebug.debugGreen('---------------UPDATE H&R COMPLETE TOTAL_SEED_TIME----------------', 'ANNOUNCE', true, req.passkeyuser);
          req.completeTorrent.update({
            $inc: {
              total_seed_time: (Date.now() - req.currentPeer.last_announce_at)
            }
          }, function () {
            done(null);
          });
        } else {
          done(null);
        }
      } else {
        done(null);
      }
    },

    /*---------------------------------------------------------------
     upload user getting score through seed timed
     include torrent seeders count coefficient value and life coefficient value
     ---------------------------------------------------------------*/
    function (done) {
      if (!req.currentPeer.isNewCreated) {
        if (req.seeder && event(query.event) !== EVENT_COMPLETED && event(query.event) !== EVENT_STARTED) {
          mtDebug.debugGreen('---------------UPLOAD SCORE THROUGH SEED TIMED----------------', 'ANNOUNCE', true, req.passkeyuser);

          if (req.torrent.torrent_status === 'reviewed') {
            var action = scoreConfig.action.seedTimed;
            var slAction = scoreConfig.action.seedSeederAndLife;

            if (action.enable) {
              var timed = Date.now() - req.currentPeer.last_announce_at;
              var seedUnit = timed / action.additionTime;
              var seedScore = seedUnit * action.timedValue;

              if (seedScore > 0) {
                //vip addition
                if (action.vipRatio && req.passkeyuser.isVip) {
                  seedScore = seedScore * action.vipRatio;
                }

                if (slAction.enable) {
                  //torrent seeders count addition
                  if (req.torrent.torrent_seeds <= slAction.seederCount) {
                    var seederUnit = slAction.seederBasicRatio + slAction.seederCoefficient * (slAction.seederCount - req.torrent.torrent_seeds + 1);
                    seedScore = seedScore * seederUnit;
                  }

                  //torrent life addition
                  var life = moment(Date.now()) - moment(req.torrent.createdat);
                  var days = life / (60 * 60 * 1000 * 24);
                  var lifeUnit = slAction.lifeBasicRatio + slAction.lifeCoefficientOfDay * days;

                  lifeUnit = lifeUnit > slAction.lifeMaxRatio ? slAction.lifeMaxRatio : lifeUnit;
                  seedScore = seedScore * lifeUnit;
                }
                seedScore = Math.round(seedScore * 100) / 100;

                action.params = {
                  tid: req.torrent._id
                };
                scoreUpdate(req, req.passkeyuser, action, seedScore);
                mtDebug.debugRed('seed timed score: ' + seedScore, 'ANNOUNCE', true, req.passkeyuser);

                done(null);
              } else {
                done(null);
              }
            } else {
              done(null);
            }
          } else {
            done(null);
          }
        } else {
          done(null);
        }
      } else {
        done(null);
      }
    },

    /*---------------------------------------------------------------
     update currentPeer.last_announce_at
     update complateTorrent refreshat
     ---------------------------------------------------------------*/
    function (done) {
      mtDebug.debugGreen('---------------UPDATE LAST_ANNOUNCE_AT----------------', 'ANNOUNCE', true, req.passkeyuser);

      if (!req.currentPeer.isNewCreated) {
        req.currentPeer.update({
          $set: {
            last_announce_at: Date.now()
          }
        }).exec();
      }

      done(null);
    },

    /*---------------------------------------------------------------
     onEventCompleted
     ---------------------------------------------------------------*/
    function (done) {
      if (event(query.event) === EVENT_COMPLETED) {
        mtDebug.debugGreen('---------------EVENT_COMPLETED----------------', 'ANNOUNCE', true, req.passkeyuser);

        if (req.currentPeer.peer_downloaded > 0 || query.downloaded > 0) {
          doCompleteEvent(function () {
            done(null);
          });
        } else {
          done(187);
          mtDebug.debugRed('Illegal completed event', 'ANNOUNCE', true, req.passkeyuser);
        }
      } else {
        done(null);
      }
    },

    /*---------------------------------------------------------------
     count H&R warning for user on normal up/down process
     ---------------------------------------------------------------*/
    function (done) {
      if (!req.currentPeer.isNewCreated) {
        if (hnrConfig.enable && req.completeTorrent && event(query.event) !== EVENT_COMPLETED) {
          mtDebug.debugGreen('---------------COUNT H&R WARNING FOR USER----------------', 'ANNOUNCE', true, req.passkeyuser);
          req.completeTorrent.countHnRWarning(false, true);
        }
      }
      done(null);
    },

    /*---------------------------------------------------------------
     onEventStopped
     count H&R warning for user when EVENT_STOPPED
     delete peers
     ---------------------------------------------------------------*/
    function (done) {
      if (event(query.event) === EVENT_STOPPED) {
        mtDebug.debugGreen('---------------EVENT_STOPPED----------------', 'ANNOUNCE', true, req.passkeyuser);

        if (hnrConfig.enable && req.completeTorrent) {
          req.completeTorrent.countHnRWarning(true, false);
        }
        removeCurrPeer(function () {
          done(null);
        });
      } else {
        done(null);
      }
    },

    /*---------------------------------------------------------------
     update torrent and user seeding/leeching count numbers
     ---------------------------------------------------------------*/
    function (done) {
      mtDebug.debugGreen('---------------COUNT TORRENT SEEDING/LEECHING----------------', 'ANNOUNCE', true, req.passkeyuser);
      req.torrent.updateSeedLeechNumbers(function (slCount) {
        req.passkeyuser.updateSeedLeechNumbers();

        if (slCount) {
          mtDebug.debugYellow(JSON.stringify(slCount), 'ANNOUNCE', true, req.passkeyuser);
          req.torrent.torrent_seeds = slCount.seedCount;
          req.torrent.torrent_leechers = slCount.leechCount;
        }
        done(null);
      });
    },

    /*---------------------------------------------------------------
     sendPeers
     compact mode
     ---------------------------------------------------------------*/
    function (done) {
      var want = WANT_DEFAULT;
      if (typeof query.numwant !== 'undefined' && query.numwant > 0)
        want = query.numwant;

      var peers = getPeers(want, req.torrent._peers);
      var hasV6ip = hasV6IP(peers);
      var peersFunction = hasV6ip ? peersDictionary : (query.compact === 0 ? peersDictionary : peersBinary);
      var resPeers = peersFunction(peers);

      var resp = bcode.encode({
        interval: ANNOUNCE_INTERVAL,
        complete: req.torrent.torrent_seeds,
        incomplete: req.torrent.torrent_leechers,
        downloaded: req.torrent.torrent_finished,
        peers: resPeers
      });

      mtDebug.debugGreen('---------------SEND RESPONSE TO USER----------------', 'ANNOUNCE', true, req.passkeyuser);
      if (peers.length > 0) {
        mtDebug.debug('ip send mode: ' + (hasV6ip ? 'IPv6' : 'IPv4'), 'ANNOUNCE', true, req.passkeyuser);
      }
      mtDebug.debug(benc.decode(resp, 'ascii'), 'ANNOUNCE', true, req.passkeyuser);

      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end(resp, 'ascii');

      done(null);
    },

    /**
     * update user, torrent, peer, complete
     * @param done
     */
    function (done) {
      req.passkeyuser.globalUpdateMethod(true);
      req.torrent.globalUpdateMethod(true);

      if (req.currentPeer) {
        req.currentPeer.globalUpdateMethod(true);
      }

      if (hnrConfig.enable && req.completeTorrent) {
        req.completeTorrent.globalUpdateMethod(true);
      }

      done(null, 'done');
    }
  ], function (err, reason) {
    if (err) {
      sendError(new Failure(err, reason));
    }
  });

  /**
   * getCurrentPeer
   * @returns {boolean}
   */
  function getCurrentPeer(callback) {
    req.selfpeer.every(function (p) {
      if (p.peer_id === query.peer_id) {
        req.currentPeer = p;
        req.currentPeer.torrent = req.torrent;
        req.currentPeer.isNewCreated = false;

        //if find peer_id, but some time some client (like qbittorrent 4.1.0) the ip or port is changed, update it
        if ((req.currentPeer.peer_ip !== req.cf_ip || req.currentPeer.peer_ipv4 !== query.ipv4 || req.currentPeer.peer_ipv6 !== query.ipv6 || req.currentPeer.peer_port !== query.port) && query.port !== 0) {
          req.currentPeer.peer_ip = req.cf_ip;
          req.currentPeer.peer_ipv4 = query.ipv4;
          req.currentPeer.peer_ipv6 = query.ipv6;
          req.currentPeer.peer_port = query.port;

          req.currentPeer.update({
            $set: {
              peer_ip: req.cf_ip,
              peer_ipv4: query.ipv4,
              peer_ipv6: query.ipv6,
              peer_port: query.port
            }
          }).exec();
        }

        if (req.seeder && req.currentPeer.peer_status !== PEERSTATE_SEEDER && event(query.event) !== EVENT_COMPLETED) {
          mtDebug.debugGreen('---------------PEER STATUS CHANGED: Seeder----------------', 'ANNOUNCE', true, req.passkeyuser);
          doCompleteEvent(function () {
            if (callback) return callback();
          });
        } else {
          if (callback) return callback();
        }
      }
      return true;
    });

    //if not found then create req.currentPeer
    if (!req.currentPeer) {
      createCurrentPeer(function () {
        if (callback) return callback();
      });
    }
  }

  /**
   * getCurrentPeerIpMode
   * @returns {string}
   */
  function getCurrentPeerIpMode() {
    if (req.currentPeer) {
      if (req.currentPeer.isIpV4V6()) {
        return 'IPV4V6';
      } else if (req.currentPeer.isIpV6()) {
        return 'IPV6';
      } else {
        return 'IPV4';
      }
    } else {
      return 'unknown';
    }
  }

  /**
   * doCompleteEvent
   */
  function doCompleteEvent(callback) {
    //write completed torrent data into finished
    var finished = new Finished();
    finished.user = req.passkeyuser;
    finished.torrent = req.torrent;
    finished.user_ip = req.cf_ip;
    finished.user_agent = req.get('User-Agent');
    finished.user_port = query.port;
    finished.save();

    traceLogCreate(req, traceConfig.action.userAnnounceFinished, {
      user: req.passkeyuser._id,
      torrent: req.torrent._id,
      agent: req.get('User-Agent'),
      ip: req.cf_ip,
      port: query.port
    });

    req.currentPeer.update({
      $set: {
        peer_status: PEERSTATE_SEEDER
      }
    }).exec();

    req.torrent.update({
      $inc: {
        torrent_finished: 1
      }
    }).exec();

    req.passkeyuser.update({
      $inc: {
        finished: 1
      }
    }).exec();

    //update completeTorrent complete status
    if (hnrConfig.enable && req.completeTorrent) {
      req.completeTorrent.update({
        $set: {
          complete: true
        }
      }, function () {
        if (callback) callback();
      });
    } else {
      if (callback) callback();
    }
  }

  /**
   * createCurrentPeer
   */
  function createCurrentPeer(callback) {
    var peer = new Peer();

    peer.user = req.passkeyuser;
    peer.torrent = req.torrent;
    peer.peer_id = query.peer_id;
    peer.peer_ip = req.cf_ip;
    peer.peer_ipv4 = query.ipv4;
    peer.peer_ipv6 = query.ipv6;
    peer.peer_port = query.port;
    peer.peer_left = query.left;
    peer.peer_status = req.seeder ? PEERSTATE_SEEDER : PEERSTATE_LEECHER;
    peer.user_agent = req.get('User-Agent');
    peer.isNewCreated = true;
    peer.last_announce_at = Date.now();

    if (req.seeder) {
      peer.finishedat = Date.now();
    }

    req.selfpeer.push(peer);

    req.torrent.update({
      $addToSet: {_peers: peer}
    }).exec();

    //save ip to user
    req.passkeyuser.addLeechedIp(peer.peer_ip);
    req.passkeyuser.addClientAgent(peer.user_agent);

    peer.save(function () {
      req.currentPeer = peer;
      mtDebug.debugGreen('---------------createCurrentPeer()----------------', 'ANNOUNCE', true, req.passkeyuser);
      if (callback) callback();
    });
  }

  /**
   * removeCurrPeer
   */
  function removeCurrPeer(callback) {
    req.selfpeer.splice(req.selfpeer.indexOf(req.currentPeer), 1);

    req.torrent._peers.forEach(function (_p) {
      if (_p._id.equals(req.currentPeer._id)) {
        req.torrent._peers.pull(_p);
        req.torrent.save();
      }
    });

    Peer.findById(req.currentPeer._id, function (err, _p) {
      _p.remove(function (err) {
        if (err) {
          mtDebug.debugGreen('---------------removeCurrPeer(): Error----------------', 'ANNOUNCE', true, req.passkeyuser);
        } else {
          mtDebug.debugGreen('---------------removeCurrPeer()----------------', 'ANNOUNCE', true, req.passkeyuser);
        }
        req.currentPeer = undefined;
        if (callback) callback();
      });
    });
  }

  /**
   * getSelfLeecherCount
   * @returns {number}
   */
  function getSelfLeecherCount() {
    if (req.selfpeer.length === 0) {
      return 0;
    } else {
      var i = 0;

      req.selfpeer.forEach(function (p) {
        if (p.peer_status === PEERSTATE_LEECHER) {
          i++;
        }
      });

      return i;
    }
  }

  /**
   * getSelfSeederCount
   * @returns {number}
   */
  function getSelfSeederCount() {
    if (req.selfpeer.length === 0) {
      return 0;
    } else {
      var i = 0;

      req.selfpeer.forEach(function (p) {
        if (p.peer_status === PEERSTATE_SEEDER) {
          i++;
        }
      });

      return i;
    }
  }

  /**
   * getUDRatio
   * @returns {{}}
   */
  function getUDRatio() {
    var udr = {};
    var sale = req.torrent.torrent_sale_status;

    var start = moment(globalSalesConfig.global.startAt, globalSalesConfig.global.timeFormats).valueOf();
    var end = start + globalSalesConfig.global.expires;
    var now = Date.now();
    isGlobalSaleValid = (now > start && now < end && globalSalesConfig.global.value) ? true : false;

    if (isGlobalSaleValid && globalSalesConfig.global.value) {
      sale = globalSalesConfig.global.value;
      mtDebug.debugRed('isGlobalSaleValid   = ' + isGlobalSaleValid, 'ANNOUNCE', true, req.passkeyuser);
      mtDebug.debugRed('global sale value   = ' + sale, 'ANNOUNCE', true, req.passkeyuser);
    }

    switch (sale) {
      case 'U1/FREE':
        udr.ur = 1;
        udr.dr = 0;
        break;
      case 'U1/D.3':
        udr.ur = 1;
        udr.dr = 0.3;
        break;
      case 'U1/D.5':
        udr.ur = 1;
        udr.dr = 0.5;
        break;
      case 'U1/D.8':
        udr.ur = 1;
        udr.dr = 0.8;
        break;
      case 'U2/FREE':
        udr.ur = 2;
        udr.dr = 0;
        break;
      case 'U2/D.3':
        udr.ur = 2;
        udr.dr = 0.3;
        break;
      case 'U2/D.5':
        udr.ur = 2;
        udr.dr = 0.5;
        break;
      case 'U2/D.8':
        udr.ur = 2;
        udr.dr = 0.8;
        break;
      case 'U2/D1':
        udr.ur = 2;
        udr.dr = 1;
        break;
      case 'U3/FREE':
        udr.ur = 3;
        udr.dr = 0;
        break;
      case 'U3/D.5':
        udr.ur = 3;
        udr.dr = 0.5;
        break;
      case 'U3/D.8':
        udr.ur = 3;
        udr.dr = 0.8;
        break;
      case 'U3/D1':
        udr.ur = 3;
        udr.dr = 1;
        break;
      default: /* U1D1 */
        udr.ur = 1;
        udr.dr = 1;
    }
    return udr;
  }

  /**
   * sendError
   * @param failure
   */
  function sendError(failure) {
    var respc = failure.bencode();
    mtDebug.debugRed(respc, 'ANNOUNCE', true, req.passkeyuser);
    res.writeHead(200, {
      'Content-Length': respc.length,
      'Content-Type': 'text/plain'
    });

    res.end(respc);
  }

  /**
   * getPeers
   * @param count
   * @param peers
   * @returns []
   */
  function getPeers(count, peers) {
    var ps = [];

    if (event(query.event) !== EVENT_STOPPED) {
      mtDebug.debugGreen('---------------GET PEERS LIST----------------', 'ANNOUNCE', true, req.passkeyuser);
      mtDebug.debugRed('want.count     = ' + count, 'ANNOUNCE', true, req.passkeyuser);
      mtDebug.debugRed('peers.length   = ' + peers.length, 'ANNOUNCE', true, req.passkeyuser);
      mtDebug.debugRed('user ip mode: ' + getCurrentPeerIpMode(), 'ANNOUNCE', true, req.passkeyuser);

      var wantedPeers;
      if (req.currentPeer.isIpV4Only()) {    //ipv4
        wantedPeers = peers.filter(function (p) {
          return p.isIpV4();
        }).sort(function () {
          return 0.5 - Math.random();
        }).slice(0, count);
      } else {                               //ipv6 or v4v6
        wantedPeers = peers.slice(0).sort(function () {
          return 0.5 - Math.random();
        }).slice(0, count);
      }

      wantedPeers.forEach(function (p) {
        if (p !== undefined && p !== req.currentPeer) {
          if (p.last_announce_at > (Date.now() - announceConfig.announceInterval - announceConfig.announceIdleTime)) { //do not send inactive peer
            var tp;
            if (p.user.equals(req.passkeyuser._id)) {
              if (announceConfig.peersCheck.peersSendListIncludeOwnSeed) {
                tp = {
                  id: p.peer_id,
                  ip: req.currentPeer.isIpV4Only() ? p.peer_ipv4 : (p.isIpV6() ? p.peer_ipv6 : p.peer_ipv4),
                  port: p.peer_port
                };
                ps.push(tp);
                mtDebug.debug(p._id.toString() + ' - SELF PEER - IP:' + tp.ip + '    PORT:' + tp.port, 'ANNOUNCE', true, req.passkeyuser);
              }
            } else {
              tp = {
                id: p.peer_id,
                ip: req.currentPeer.isIpV4Only() ? p.peer_ipv4 : (p.isIpV6() ? p.peer_ipv6 : p.peer_ipv4),
                port: p.peer_port
              };
              ps.push(tp);
              mtDebug.debug(p._id.toString() + '    IP:' + tp.ip + '    PORT:' + tp.port, 'ANNOUNCE', true, req.passkeyuser);
            }
          }
        }
      });
    }
    return ps;
  }

  /**
   * hasV6IP
   * @param peers
   * @returns {boolean}
   */
  function hasV6IP(peers) {
    for (let p of peers) {
      if (ipRegex.v6({exact: true}).test(p.ip)) {
        return true;
      }
    }
    return false;
  }

  /**
   * peersDictionary
   * @param peers
   */
  function peersDictionary(peers) {
    return peers.map(function (peer) {
      if (query.no_peer_id === 1) {
        return {
          'ip': peer.ip,
          'port': peer.port
        };
      } else {
        return {
          'peer id': peer.id,
          'ip': peer.ip,
          'port': peer.port
        };
      }
    });
  }

  /**
   * peersBinary
   * @param peers
   * @returns {string}
   */
  function peersBinary(peers) {
    var tokens = [];
    peers.forEach(function (peer) {
      tokens.push(peerBinary(peer.ip, peer.port));
    });
    return tokens.join('');
  }

  /**
   * peerBinary
   * @param ip
   * @param port
   * @returns {string}
   */
  function peerBinary(ip, port) {
    var tokens = [];

    var octets = ip.split('.');
    if (octets.length !== 4) return '';

    octets.forEach(function (octet) {
      var val = parseInt(octet, 10);
      if (!isNaN(val)) tokens.push(val);
    });
    if (tokens.length !== 4) return '';

    tokens.push((port >> 8) & 0xff);
    tokens.push(port & 0xff);

    return String.fromCharCode.apply(tokens, tokens);
  }
};

/**
 * userByPasskey
 * @param req
 * @param res
 * @param next
 * @param pk
 * @returns {*}
 */
exports.userByPasskey = function (req, res, next, pk) {
  User.findOne({passkey: pk})
    .exec(function (err, u) {
      if (u) {
        req.passkeyuser = u;
      } else {
        req.passkeyuser = undefined;
      }
      next();
    });
};
