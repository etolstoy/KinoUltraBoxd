"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.process = process;
const htmlParsingService_1 = require("./htmlParsingService");
/**
 * Stub function to process a list of HTML file contents into film data models.
 * @param htmlFiles Array of HTML file contents as strings
 * @returns Array of FilmData (currently always empty)
 */
function process(htmlFiles) {
    console.log('process');
    const kinopoiskIds = (0, htmlParsingService_1.parseKinopoiskIdsFromHtmlFiles)(htmlFiles);
    console.log('Extracted kinopoiskIds:', kinopoiskIds);
    // TODO: Implement actual processing logic
    return [];
}
