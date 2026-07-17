"use strict";

var LZString = require("lz-string");

var PREFIX = "lz16:";

function compress(value) {
  return PREFIX + LZString.compressToUTF16(String(value == null ? "" : value));
}

function isCompressed(value) {
  return typeof value === "string" && value.slice(0, PREFIX.length) === PREFIX;
}

function decompress(value) {
  var text = String(value == null ? "" : value);
  var result;

  if (!isCompressed(text)) {
    return text;
  }
  result = LZString.decompressFromUTF16(text.slice(PREFIX.length));
  if (typeof result !== "string") {
    throw new Error("Compressed storage value is invalid");
  }
  return result;
}

module.exports = {
  compress: compress,
  decompress: decompress,
  isCompressed: isCompressed,
  prefix: PREFIX
};
