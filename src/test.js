// Tests are outdated
// TODO: update
// TODO: implement a test dictionary to test that the dictionaries never choose impossible prompts

/*
var gameServer = require("./game.server.js");
var gameRoom = require("./game.room.js");

console.time("loadDictionaries");
gameServer.init();
console.timeEnd("loadDictionaries");


var g = new gameRoom("", null, gameServer.dictionaries);
console.time("copy-1000-Dictionaries");
for (var i = 0; i < 1000; i++) {
    g.newDictionary("en");
}
console.timeEnd("copy-1000-Dictionaries");

console.time("generate-10000-Prompts");
for (var j = 0; j < 10000; j++) {
    g.generatePrompt();
}
console.timeEnd("generate-10000-Prompts");
*/

/** Test results:
 * loadDictionaries: 4614ms
 * copy-1000-Dictionaries: 8214ms
 * generate-100000-prompts: 11146ms
 */
