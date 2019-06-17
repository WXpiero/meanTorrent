'use strict';

/**
 * Module dependencies
 */
var acl = require('acl');

// Using the memory backend
acl = new acl(new acl.memoryBackend());

/**
 * Invoke Invitations Permissions
 */
exports.invokeRolesPolicies = function () {
  acl.allow(
    [
      {
        roles: ['admin', 'oper', 'user'],
        allows: [
          {resources: '/api/messageTickets', permissions: '*'},
          {resources: '/api/messageTickets/handle/:messageTicketId', permissions: '*'},
          {resources: '/api/messageTickets/solved/:messageTicketId', permissions: '*'},
          {resources: '/api/messageTickets/:messageTicketId', permissions: '*'},
          {resources: '/api/messageTickets/:messageTicketId/:replyId', permissions: '*'},
          {resources: '/api/messageTickets/uploadTicketImage', permissions: '*'},
          {resources: '/api/messageTickets/openedCount', permissions: '*'},

          {resources: '/api/mailTickets', permissions: '*'},
          {resources: '/api/mailTickets/:mailTicketId', permissions: '*'},
          {resources: '/api/mailTickets/:mailTicketId/:replyId', permissions: '*'},
          {resources: '/api/mailTickets/openedCount', permissions: '*'},
          {resources: '/api/mailTickets/openedAllCount', permissions: '*'}
        ]
      }
    ]
  );
};

/**
 * Check If Invitations Policy Allows
 */
exports.isAllowed = function (req, res, next) {
  var roles = (req.user) ? req.user.roles : ['guest'];

  // Check for user roles
  acl.areAnyRolesAllowed(roles, req.route.path, req.method.toLowerCase(), function (err, isAllowed) {
    if (err) {
      // An authorization error occurred
      return res.status(500).send('Unexpected authorization error');
    } else {
      if (isAllowed) {
        // Access granted! Invoke next middleware
        return next();
      } else {
        return res.status(403).json({
          message: 'User is not authorized'
        });
      }
    }
  });
};
