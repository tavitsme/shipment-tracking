/**
 * rateLimit.js — express-rate-limit middleware for POST /api/track.
 *
 * Limits: 30 requests per 15 minutes per client IP. Enough for a human
 * checking several parcels, too tight for a scraper. Standard headers
 * (RateLimit-* ) are sent; legacy X-RateLimit-* headers are disabled to keep
 * the response surface clean.
 *
 * On limit exceeded: HTTP 429 with a JSON body shaped like our other error
 * responses ({ success:false, error }).
 */
'use strict';

const rateLimit = require('express-rate-limit');

const trackRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // limit each IP to 30 requests per window
  standardHeaders: true, // send RateLimit-* headers
  legacyHeaders: false, // disable X-RateLimit-* headers
  statusCode: 429,
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
  },
});

module.exports = trackRateLimit;
