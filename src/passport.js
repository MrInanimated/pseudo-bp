// ./passport.js
//
// Eh, don't touch this unless you know what you're doing
// If you are configuring a new strategy, remember to add the appropriate
// pages in routes.js

var
    SteamStrategy    = require('passport-steam').Strategy,
    TwitchStrategy   = require('passport-twitch-new').Strategy,
    TwitterStrategy  = require('passport-twitter'),
    config           = require('./config/passport.js');

module.exports = function (passport) {
    passport.serializeUser(function(user, done) {
        done(null, user);
    });

    passport.deserializeUser(function (user, done) {
        done(null, user);
    });

    passport.use("steam", new SteamStrategy(config.steam,
        function (identifier, profile, done) {
            return done(null, {
                authId: "steam:" + profile.id,
                service: "steam",
                username: profile.displayName,
                displayName: profile.displayName,
                profileImage: profile._json.avatarmedium ? profile._json.avatarmedium : undefined,
            });
        })
    );

    passport.use("twitch", new TwitchStrategy(config.twitch,
        function (accessToken, refreshToken, profile, done) {
            return done(null, {
                authId: "twitch:" + profile.id,
                service: "twitch",
                username: profile.login,
                displayName: profile.display_name,
                profileImage: profile.profile_image_url ? profile.profile_image_url : undefined,
            });
        })
    );

    passport.use("twitter", new TwitterStrategy(config.twitter,
        function (token, tokenSecret, profile, done) {
            return done(null, {
                authId: "twitter:" + profile.id,
                service: "twitter",
                username: profile.username,
                displayName: profile.displayName,
                profileImage: profile._json.profile_image_url_https ? profile._json.profile_image_url_https : undefined,
            });
        })
    );
};
