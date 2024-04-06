// ./app.ts
//
// Entry point into the app.

import * as winston from "winston";
import express from "express";
import * as http from "http";
import cookieParser from "cookie-parser";

// untyped imports
const gameServer = require("./game.server.js");

const gameport = process.env.PORT || 9225;
const app = express();
const server = http.createServer(app);

/* Set up the logger */
var logger = winston.createLogger({
    transports: [
        new winston.transports.Console({
            handleExceptions: true,
            format: winston.format.combine(
                winston.format.splat(),
                winston.format.simple(),
            ),
        }),
    ],
});

/* Set up for Express server. */

// Set up the templating engine
app.set("views", __dirname + "/tpl");
app.set("view engine", "jade");
app.engine("jade", require("pug").__express);

// Set up cookie parsing
app.use(cookieParser());


// Set up routes
require("./routes.js")(app, gameServer);

// Set the resources folder
app.use(express.static(__dirname + "/public"));

// Listen for incoming connections
server.listen(gameport);
logger.info("Express listening on port " + gameport);

// Set up the socket.io server
require("./socket.js")(server, gameServer, logger);

logger.info("Server ready.");

if (global.gc) {
    setInterval(function () {
        global.gc();
        logger.debug("GC run.");
    }, 1000 * 30);
}
