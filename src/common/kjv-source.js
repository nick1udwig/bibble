"use strict";

var REPOSITORY = "nick1udwig/bible";
var REF = "master";
var FILE_PATH = "json/en_kjv.json";

module.exports = {
  repository: REPOSITORY,
  ref: REF,
  path: FILE_PATH,
  url: "https://raw.githubusercontent.com/" + REPOSITORY + "/" + REF + "/" + FILE_PATH,
  storageVersion: "nick1udwig-bible-master-v1"
};
