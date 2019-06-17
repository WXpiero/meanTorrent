(function () {
  'use strict';

  angular
    .module('about')
    .controller('AboutController', AboutController);

  AboutController.$inject = ['$scope', '$state', 'getStorageLangService', 'MeanTorrentConfig', 'AdminService', 'MakerGroupService', 'DebugConsoleService', 'marked',
    'localStorageService', '$translate', '$compile', 'Authentication', 'DownloadService', 'TorrentGetInfoServices', 'ResourcesTagsServices',
    'uibButtonConfig', '$window', '$timeout', 'TorrentsService', 'ModalConfirmService', 'NotifycationService', '$templateRequest', '$filter'];

  function AboutController($scope, $state, getStorageLangService, MeanTorrentConfig, AdminService, MakerGroupService, mtDebug, marked,
                           localStorageService, $translate, $compile, Authentication, DownloadService, TorrentGetInfoServices, ResourcesTagsServices,
                           uibButtonConfig, $window, $timeout, TorrentsService, ModalConfirmService, NotifycationService, $templateRequest, $filter) {
    var vm = this;
    vm.DLS = DownloadService;
    vm.TGI = TorrentGetInfoServices;
    vm.user = Authentication.user;
    vm.RTS = ResourcesTagsServices;
    vm.lang = getStorageLangService.getLang();
    vm.blackListConfig = MeanTorrentConfig.meanTorrentConfig.clientBlackList;
    vm.appConfig = MeanTorrentConfig.meanTorrentConfig.app;
    vm.supportConfig = MeanTorrentConfig.meanTorrentConfig.support;
    vm.scoreConfig = MeanTorrentConfig.meanTorrentConfig.score;
    vm.announce = MeanTorrentConfig.meanTorrentConfig.announce;
    vm.itemsPerPageConfig = MeanTorrentConfig.meanTorrentConfig.itemsPerPage;
    vm.torrentTypeConfig = MeanTorrentConfig.meanTorrentConfig.torrentType;
    vm.inputLengthConfig = MeanTorrentConfig.meanTorrentConfig.inputLength;
    vm.rssConfig = MeanTorrentConfig.meanTorrentConfig.rss;
    vm.ircConfig = MeanTorrentConfig.meanTorrentConfig.ircAnnounce;
    vm.signConfig = MeanTorrentConfig.meanTorrentConfig.sign;
    vm.inviteConfig = MeanTorrentConfig.meanTorrentConfig.invite;
    vm.requestsConfig = MeanTorrentConfig.meanTorrentConfig.requests;
    vm.hnrConfig = MeanTorrentConfig.meanTorrentConfig.hitAndRun;
    vm.tmdbConfig = MeanTorrentConfig.meanTorrentConfig.tmdbConfig;
    vm.salesTypeConfig = MeanTorrentConfig.meanTorrentConfig.torrentSalesType;
    vm.salesGlobalConfig = MeanTorrentConfig.meanTorrentConfig.torrentGlobalSales;
    vm.ircAnnounceConfig = MeanTorrentConfig.meanTorrentConfig.ircAnnounce;
    vm.passwordConfig = MeanTorrentConfig.meanTorrentConfig.password;
    vm.examinationConfig = MeanTorrentConfig.meanTorrentConfig.examination;
    vm.chatConfig = MeanTorrentConfig.meanTorrentConfig.chat;
    vm.accessConfig = MeanTorrentConfig.meanTorrentConfig.access;
    vm.resourcesTags = MeanTorrentConfig.meanTorrentConfig.resourcesTags;

    vm.searchTags = [];
    vm.searchKey = '';
    vm.releaseYear = undefined;
    vm.filterType = undefined;
    vm.filterHnR = false;
    vm.filterTop = false;
    vm.filterUnique = false;
    vm.filterSale = false;
    vm.torrentRLevel = 'level0';

    uibButtonConfig.activeClass = 'btn-success';

    vm.torrentType = 'aggregate';
    vm.filterType = localStorageService.get('maker_last_selected_type') || 'aggregate';

    vm.addMemberPopover = {
      title: 'ABOUT.ADD_MEMBER_TITLE',
      templateUrl: 'add-member.html',
      isOpen: false
    };

    /**
     * scope watch vm.filterType
     */
    $scope.$watch('vm.filterType', function (newValue, oldValue) {
      if (newValue) {
        localStorageService.set('maker_last_selected_type', newValue);
      }
    });

    /**
     * getTemplateFileContent
     * @param file
     */
    vm.getTemplateFileContent = function (file) {
      $templateRequest(file, true).then(function (response) {
        vm.templateFileContent = response;
      });
    };

    /**
     * getTemplateMarkedContent
     * @returns {*}
     */
    vm.getTemplateMarkedContent = function () {
      var tmp = $filter('fmt')(vm.templateFileContent, {
        appConfig: vm.appConfig,
        supportConfig: vm.supportConfig,
        announceConfig: vm.announce,
        scoreConfig: vm.scoreConfig,
        rssConfig: vm.rssConfig,
        ircConfig: vm.ircConfig,
        signConfig: vm.signConfig,
        inviteConfig: vm.inviteConfig,
        requestsConfig: vm.requestsConfig,
        hnrConfig: vm.hnrConfig,
        tmdbConfig: vm.tmdbConfig,
        salesTypeConfig: vm.salesTypeConfig,
        salesGlobalConfig: vm.salesGlobalConfig,
        ircAnnounceConfig: vm.ircAnnounceConfig,
        passwordConfig: vm.passwordConfig,
        examinationConfig: vm.examinationConfig,
        chatConfig: vm.chatConfig,
        accessConfig: vm.accessConfig,

        user: vm.user
      });

      tmp = $filter('translate')(tmp);

      return marked(tmp, {sanitize: false});
    };

    /**
     * buildPager
     */
    vm.buildPager = function () {
      vm.pagedItems = [];
      vm.itemsPerPage = vm.itemsPerPageConfig.makeGroupTorrentsPerPage;
      vm.currentPage = 1;

      vm.tooltipMsg = 'ABOUT.MAKER_TORRENTS_IS_LOADING';
      vm.figureOutItemsToDisplay();
    };

    /**
     * figureOutItemsToDisplay
     * @param callback
     */
    vm.figureOutItemsToDisplay = function (callback) {
      vm.getMakerTorrents(vm.currentPage, function (items) {
        vm.filterLength = items.total;
        vm.pagedItems = items.rows;

        if (vm.pagedItems.length === 0) {
          vm.tooltipMsg = 'ABOUT.MAKER_TORRENTS_IS_EMPTY';
        } else {
          vm.tooltipMsg = undefined;
        }
        if (callback) callback();
      });
    };

    /**
     * onTorrentTypeChanged
     */
    vm.onTorrentTypeChanged = function () {
      vm.buildPager();
      localStorageService.set('maker_last_selected_type', vm.filterType);
    };

    /**
     * tagsFilter
     * @param item
     * @returns {boolean}
     */
    vm.tagsFilter = function (item) {
      var res = false;

      if (vm.filterType === 'aggregate') {
        angular.forEach(vm.torrentTypeConfig.value, function (t) {
          if (t.enable && item.cats.includes(t.value))
            res = true;
        });
      } else {
        if (item.cats.includes(vm.filterType))
          res = true;
      }

      return res;
    };

    /**
     * orderByVote
     */
    vm.orderByVote = function () {
      vm.sortSLF = undefined;
      vm.sortSize = undefined;
      vm.sortLife = undefined;

      if (vm.sortVote === undefined) {
        vm.sortVote = '-';
        vm.sort = {'resource_detail_info.vote_average': -1};
      } else if (vm.sortVote === '-') {
        vm.sortVote = undefined;
        vm.sort = undefined;
      }

      vm.buildPager();
    };

    /**
     * orderBySize
     */
    vm.orderBySize = function () {
      vm.sortSLF = undefined;
      vm.sortVote = undefined;
      vm.sortLife = undefined;

      if (vm.sortSize === undefined) {
        vm.sortSize = '-';
        vm.sort = {'torrent_size': -1};
      } else if (vm.sortSize === '-') {
        vm.sortSize = undefined;
        vm.sort = undefined;
      }

      vm.buildPager();
    };

    /**
     * orderByLife
     */
    vm.orderByLife = function () {
      vm.sortSLF = undefined;
      vm.sortVote = undefined;
      vm.sortSize = undefined;

      if (vm.sortLife === undefined) {
        vm.sortLife = '-';
        vm.sort = {'createdat': 1};
      } else if (vm.sortLife === '-') {
        vm.sortLife = undefined;
        vm.sort = undefined;
      }

      vm.buildPager();
    };

    /**
     * orderBySLF
     */
    vm.orderBySLF = function () {
      vm.sortVote = undefined;
      vm.sortSize = undefined;
      vm.sortLife = undefined;

      if (vm.sortSLF === undefined) {
        vm.sortSLF = '-S';
        vm.sort = {torrent_seeds: -1};
      } else if (vm.sortSLF === '-S') {
        vm.sortSLF = '-L';
        vm.sort = {torrent_leechers: -1};
      } else if (vm.sortSLF === '-L') {
        vm.sortSLF = '-F';
        vm.sort = {torrent_finished: -1};
      } else if (vm.sortSLF === '-F') {
        vm.sortSLF = undefined;
        vm.sort = undefined;
      }

      vm.buildPager();
    };

    /**
     *
     * @returns {string|Object}
     */
    vm.getOrderTableHead = function () {
      var res = $translate.instant('TABLE_FIELDS.SEEDS_LEECHERS_FINISHED');
      switch (vm.sortSLF) {
        case '-S':
          res = $translate.instant('TABLE_FIELDS.SORT_S');
          res += '<i class="fa fa-caret-down text-info"></i>';
          res += '/' + $translate.instant('TABLE_FIELDS.SORT_L');
          res += '/' + $translate.instant('TABLE_FIELDS.SORT_F');
          break;
        case '+S':
          res = $translate.instant('TABLE_FIELDS.SORT_S');
          res += '<i class="fa fa-caret-up text-info"></i>';
          res += '/' + $translate.instant('TABLE_FIELDS.SORT_L');
          res += '/' + $translate.instant('TABLE_FIELDS.SORT_F');
          break;
        case '-L':
          res = $translate.instant('TABLE_FIELDS.SORT_S');
          res += '/' + $translate.instant('TABLE_FIELDS.SORT_L');
          res += '<i class="fa fa-caret-down text-info"></i>';
          res += '/' + $translate.instant('TABLE_FIELDS.SORT_F');
          break;
        case '+L':
          res = $translate.instant('TABLE_FIELDS.SORT_S');
          res += '/' + $translate.instant('TABLE_FIELDS.SORT_L');
          res += '<i class="fa fa-caret-up text-info"></i>';
          res += '/' + $translate.instant('TABLE_FIELDS.SORT_F');
          break;
        case '-F':
          res = $translate.instant('TABLE_FIELDS.SORT_S');
          res += '/' + $translate.instant('TABLE_FIELDS.SORT_L');
          res += '/' + $translate.instant('TABLE_FIELDS.SORT_F');
          res += '<i class="fa fa-caret-down text-info"></i>';
          break;
        case '+F':
          res = $translate.instant('TABLE_FIELDS.SORT_S');
          res += '/' + $translate.instant('TABLE_FIELDS.SORT_L');
          res += '/' + $translate.instant('TABLE_FIELDS.SORT_F');
          res += '<i class="fa fa-caret-up text-info"></i>';
          break;
      }
      return res;
    };

    /**
     * getMakerTorrents
     * @param p
     * @param callback
     */
    vm.getMakerTorrents = function (p, callback) {
      TorrentsService.get({
        skip: (p - 1) * vm.itemsPerPage,
        limit: vm.itemsPerPage,
        sort: vm.sort,
        torrent_type: (vm.filterType && vm.filterType !== 'aggregate') ? vm.filterType : (vm.torrentType === 'aggregate' ? 'all' : vm.torrentType),
        torrent_status: 'reviewed',
        maker: vm.maker._id,
        keys: vm.searchKey,
        torrent_vip: false,
        torrent_rlevel: vm.torrentRLevel,
        torrent_release: vm.releaseYear,
        torrent_tags: vm.searchTags,
        torrent_hnr: vm.filterHnR,
        torrent_sale: vm.filterSale,
        isTop: vm.filterTop,
        isUnique: vm.filterUnique
      }, function (data) {
        mtDebug.info(data);
        callback(data);
      }, function (err) {
        Notification.error({
          message: '<i class="glyphicon glyphicon-remove"></i> ' + $translate.instant('ABOUT.MAKER_TORRENTS_LIST_ERROR')
        });
      });
    };


    /**
     * pageChanged
     */
    vm.pageChanged = function () {
      var element = angular.element('#top_of_torrent_list');

      $('.tb-v-middle').fadeTo(100, 0.01, function () {
        vm.figureOutItemsToDisplay(function () {
          $timeout(function () {
            $('.tb-v-middle').fadeTo(400, 1, function () {
              //window.scrollTo(0, element[0].offsetTop - 60);
              $('html,body').animate({scrollTop: element[0].offsetTop - 60}, 200);
            });
          }, 100);
        });
      });
    };

    /**
     * getMaker
     */
    vm.getMaker = function () {
      MakerGroupService.get({
        makerId: $state.params.makerId
      }, function (data) {
        vm.maker = data;
        vm.rating_vote = vm.maker.vote_average;

        mtDebug.info(data);

        vm.buildPager();
      });

    };

    /**
     * isOwner
     * @param m, maker
     * @returns {boolean}
     */
    vm.isOwner = function (m) {
      if (m) {
        if (m.user._id === vm.user._id) {
          return true;
        } else {
          return false;
        }
      } else {
        return false;
      }
    };

    /**
     * isFounder
     * @param u
     * @param m
     * @returns {boolean}
     */
    vm.isFounder = function (u, m) {
      if (m && u) {
        if (m.user._id === u._id) {
          return true;
        } else {
          return false;
        }
      } else {
        return false;
      }
    };

    /**
     * getMakerDescContent
     * @param m
     * @returns {*}
     */
    vm.getMakerDescContent = function (m) {
      return m ? marked(m.desc, {sanitize: true}) : '';
    };

    /**
     * addMember
     */
    vm.addMember = function () {
      MakerGroupService.addMember({
        _id: vm.maker._id,
        _username: vm.addMemberPopover.username
      }, function (res) {
        vm.maker = res;
        NotifycationService.showSuccessNotify('ABOUT.ADD_MEMBER_SUCCESSFULLY');
        vm.addMemberPopover.isOpen = false;
      }, function (res) {
        NotifycationService.showErrorNotify(res.data.message, 'ABOUT.ADD_MEMBER_FAILED');
        vm.addMemberPopover.isOpen = false;
      });
    };

    /**
     * removeMember
     * @param f forum
     * @param m moderator
     */
    vm.removeMember = function (m, u) {
      var modalOptions = {
        closeButtonText: $translate.instant('ABOUT.DELETE_CONFIRM_CANCEL'),
        actionButtonText: $translate.instant('ABOUT.DELETE_CONFIRM_OK'),
        headerText: $translate.instant('ABOUT.DELETE_CONFIRM_HEADER_TEXT'),
        bodyText: $translate.instant('ABOUT.DELETE_MEMBER_CONFIRM_BODY_TEXT')
      };

      ModalConfirmService.showModal({}, modalOptions)
        .then(function (result) {
          MakerGroupService.removeMember({
            _id: m._id,
            _username: u.username
          }, function (res) {
            vm.maker = res;
            NotifycationService.showSuccessNotify('ABOUT.REMOVE_MEMBER_SUCCESSFULLY');
          }, function (res) {
            NotifycationService.showErrorNotify(res.data.message, 'ABOUT.REMOVE_MEMBER_FAILED');
          });
        });
    };

    /**
     * beginEditMakerDesc
     * @param m
     */
    vm.beginEditMakerDesc = function (m) {
      var el = $('#' + m._id);

      el.markdown({
        autofocus: true,
        savable: true,
        hideable: true,
        iconlibrary: 'fa',
        resize: 'vertical',
        language: localStorageService.get('storage_user_lang'),
        fullscreen: {enable: false},
        onSave: function (e) {
          if (e.isDirty()) {
            vm.maker.desc = e.getContent();
            vm.maker.$update(function (res) {
              vm.maker = res;
              NotifycationService.showSuccessNotify('ABOUT.EDIT_DESC_SUCCESSFULLY');
            }, function (res) {
              NotifycationService.showErrorNotify(res.data.message, 'ABOUT.EDIT_DESC_FAILED');
            });

            e.$options.hideable = true;
            e.blur();
          } else {
            e.$options.hideable = true;
            e.blur();
          }
        },
        onChange: function (e) {
          e.$options.hideable = false;
        },
        onShow: function (e) {
          $('#' + e.$editor.attr('id') + ' .md-input').textcomplete([
            { // emoji strategy
              match: /\B:([\-+\w]*)$/,
              search: function (term, callback) {
                callback($.map(window.emojies, function (emoji) {
                  return emoji.indexOf(term) === 0 ? emoji : null;
                }));
              },
              template: function (value) {
                return '<img class="ac-emoji" src="/graphics/emojis/' + value + '.png" />' + '<span class="ac-emoji-text">' + value + '</span>';
              },
              replace: function (value) {
                return ':' + value + ': ';
              },
              index: 1
            }
          ]);

          e.setContent(m.desc);
          $('#' + e.$editor.attr('id') + ' .md-input').attr('maxlength', vm.inputLengthConfig.makerGroupDescLength);

          var elei = $('#' + e.$editor.attr('id') + ' .md-input');
          angular.element(elei).css('height', '200px');
          angular.element(elei).css('color', '#333');

          var inputInfo = angular.element('<span></span>');
          inputInfo.addClass('pull-right');
          inputInfo.addClass('input-length');
          inputInfo.text(e.getContent().length + '/' + vm.inputLengthConfig.makerGroupDescLength);
          $('#' + e.$editor.attr('id') + ' .md-header').append(inputInfo);
          $('#' + e.$editor.attr('id') + ' .md-input').on('input propertychange', function (evt) {
            inputInfo.text(e.getContent().length + '/' + vm.inputLengthConfig.makerGroupDescLength);
          });

          var ele = $('#' + e.$editor.attr('id') + ' .md-footer');
          angular.element(ele).addClass('text-right');
          angular.element(ele[0].childNodes[0]).addClass('btn-min-width-80');
          ele[0].childNodes[0].innerText = $translate.instant('FORUMS.BTN_SAVE');

          var cbtn = angular.element('<button class="btn btn-default btn-min-width-80 margin-left-10">' + $translate.instant('FORUMS.BTN_CANCEL') + '</button>');
          cbtn.bind('click', function (evt) {
            e.setContent(m.desc);
            e.$options.hideable = true;
            e.blur();
          });
          ele.append(cbtn);
          $compile(e.$editor.contents())($scope);
        },
        onPreview: function (e) {
          $('#' + e.$editor.attr('id') + ' .md-footer').css('display', 'none');
        },
        onPreviewEnd: function (e) {
          $('#' + e.$editor.attr('id') + ' .md-footer').css('display', 'block');
        }
      });
    };

    /**
     * beginRemoveMakerGroup
     * @param m
     */
    vm.beginRemoveMakerGroup = function (m) {
      var modalOptions = {
        closeButtonText: $translate.instant('ABOUT.DELETE_CONFIRM_CANCEL'),
        actionButtonText: $translate.instant('ABOUT.DELETE_CONFIRM_OK'),
        headerText: $translate.instant('ABOUT.DELETE_CONFIRM_HEADER_TEXT'),
        bodyText: $translate.instant('ABOUT.DELETE_CONFIRM_BODY_TEXT')
      };

      ModalConfirmService.showModal({}, modalOptions)
        .then(function (result) {
          m.$remove(function (res) {
            NotifycationService.showSuccessNotify('ABOUT.DELETE_SUCCESSFULLY');
            $state.go('about.maker');
          }, function (res) {
            NotifycationService.showErrorNotify(res.data.message, 'ABOUT.DELETE_FAILED');
          });
        });
    };

    /**
     * setMakerUploadAccess
     * @param acc
     */
    vm.setMakerUploadAccess = function (acc) {
      vm.maker.upload_access = acc;
      vm.maker.$update(function (res) {
        vm.maker = res;
        NotifycationService.showSuccessNotify('UPLOADER.ACCESS_CHANGED_SUCCESSFULLY');
      });

    };

    /**
     * ratingMaker
     * @param item
     */
    vm.ratingMaker = function (item) {
      item.$rating({
        vote: vm.rating_vote
      }, function (res) {
        vm.maker = res;
        vm.rating_vote = vm.maker.vote_average;

        NotifycationService.showSuccessNotify('ABOUT.RATING_SUCCESSFULLY');
      }, function (res) {
        vm.rating_vote = vm.maker.vote_average;
        NotifycationService.showErrorNotify(res.data.message, 'ABOUT.RATING_FAILED');
      });
    };

    /**
     * getOperList
     */
    vm.getOperList = function () {
      AdminService.get({
        isOper: true,
        isAdmin: true
      }, function (data) {
        vm.operList = data.rows;
      });
    };

    /**
     * getMakerList
     */
    vm.getMakerList = function () {
      MakerGroupService.query(function (data) {
        vm.makerList = data;
        mtDebug.info(data);
      });
    };

    /**
     * spinCog
     */
    vm.spinCog = function (evt, id) {
      var e = $('#cog_' + id);
      e.addClass('fa-spin');
    };

    /**
     * stopCog
     */
    vm.stopCog = function (evt, id) {
      var e = $('#cog_' + id);
      e.removeClass('fa-spin');
    };

    /**
     * onMoreTagsClicked
     */
    vm.onMoreTagsClicked = function () {
      var e = $('.more-tags');
      var i = $('#more-tags-icon');

      if (!e.hasClass('panel-collapsed')) {
        e.slideUp();
        e.addClass('panel-collapsed');
        i.removeClass('glyphicon-chevron-up').addClass('glyphicon-chevron-down');
      } else {
        e.slideDown();
        e.removeClass('panel-collapsed');
        i.removeClass('glyphicon-chevron-down').addClass('glyphicon-chevron-up');
      }
    };

    /**
     * clearAllCondition
     */
    vm.clearAllCondition = function () {
      vm.searchKey = '';
      vm.searchTags = [];
      $('.btn-tag').removeClass('btn-success').addClass('btn-default');
      vm.releaseYear = undefined;
      vm.filterHnR = false;
      vm.filterTop = false;
      vm.filterUnique = false;
      vm.filterSale = false;
      vm.torrentRLevel = 'level0';
      vm.filterType = 'aggregate';

      vm.buildPager();
    };

    /**
     * onTorrentTypeClicked
     * @param t
     */
    vm.onTorrentTypeClicked = function (t) {
      if (vm.filterType === t) {
        vm.filterType = vm.torrentType;
      } else {
        vm.filterType = t;
      }
      vm.buildPager();
    };

    /**
     * onRLevelClicked
     * @param y
     */
    vm.onRLevelClicked = function (l) {
      if (vm.torrentRLevel === l) {
        vm.torrentRLevel = 'level0';
      } else {
        vm.torrentRLevel = l;
      }
      vm.buildPager();
    };

    /**
     * onReleaseClicked
     * @param y
     */
    vm.onReleaseClicked = function (y) {
      if (vm.releaseYear === y) {
        vm.releaseYear = undefined;
      } else {
        vm.releaseYear = y;
      }
      vm.buildPager();
    };

    /**
     * onHnRClicked
     */
    vm.onHnRClicked = function () {
      vm.filterHnR = !vm.filterHnR;
      vm.buildPager();
    };
    vm.onHnRChanged = function () {
      vm.buildPager();
    };

    /**
     * onTopClicked, onTopChanged
     */
    vm.onTopClicked = function () {
      vm.filterTop = !vm.filterTop;
      vm.buildPager();
    };
    vm.onTopChanged = function () {
      vm.buildPager();
    };

    /**
     * onUniqueClicked, onUniqueChanged
     */
    vm.onUniqueClicked = function () {
      vm.filterUnique = !vm.filterUnique;
      vm.buildPager();
    };
    vm.onUniqueChanged = function () {
      vm.buildPager();
    };

    /**
     * onSaleChanged
     */
    vm.onSaleClicked = function () {
      vm.filterSale = !vm.filterSale;
      vm.buildPager();
    };
    vm.onSaleChanged = function () {
      vm.buildPager();
    };
  }
}());
