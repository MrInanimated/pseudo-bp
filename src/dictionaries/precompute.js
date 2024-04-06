/* jshint esversion:6 */
/* jshint -W083 */
var fs = require("fs");
var spec = require("./dictionaries.json");

var precomputed = {};

for (var n in spec) {
    var s = spec[n];
    if (s.formats.Normal) {
        var data = fs.readFileSync(__dirname + "/" + s.path);
        var words = data.toString().split(/\r?\n/g).filter(function (w) {
            return /^[a-z]+$/.test(w);
        }).sort();

        precomputed[n] = {
            promptFrequencies: {},
            prompts: {},
        };
        var that = precomputed[n];

        var sortFunction = function (a, b) {
            return that.promptFrequencies[b.length][n] - that.promptFrequencies[a.length][a];
        };

        for (var i = 1; i <= 5; i++) {
            that.promptFrequencies[i] = {};
            that.prompts[i] = [];
            for (var word of words) {
                if (word.length >= i) {
                    for (var j = 0; j < word.length - i + 1; j++) {
                        var substr = word.slice(j, j+i);
                        if (that.promptFrequencies[i][substr])
                            that.promptFrequencies[i][substr]++;
                        else {
                            that.promptFrequencies[i][substr] = 1;
                            that.prompts[i].push(substr);
                        }
                    }
                }
            }
        }
    }
}

fs.writeFileSync(__dirname + "/precomputed.json", JSON.stringify(precomputed, null, 4));
