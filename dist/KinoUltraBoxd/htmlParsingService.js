"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseKinopoiskIdsFromHtmlFiles = parseKinopoiskIdsFromHtmlFiles;
const cheerio = __importStar(require("cheerio"));
console.log('[htmlParsingService] module loaded');
/**
 * Parses provided HTML files and extracts kinopoiskIds from valid Kinopoisk pages.
 * @param htmlFiles Array of HTML file contents as strings
 * @returns Array of kinopoiskIds (number)
 */
function parseKinopoiskIdsFromHtmlFiles(htmlFiles) {
    console.log('[htmlParsingService] function start');
    const allIds = [];
    htmlFiles.forEach((html, idx) => {
        const $ = cheerio.load(html);
        const hasProfileFilmsList = $('.profileFilmsList').length > 0;
        const hasKinopoiskHeader = $('meta[property="og:site_name"]').attr('content')?.includes('Кинопоиск') || false;
        const items = $('.profileFilmsList .item');
        const hasItems = items.length > 0;
        console.log(`[htmlParsingService] File #${idx + 1}: hasProfileFilmsList=${hasProfileFilmsList}, hasKinopoiskHeader=${hasKinopoiskHeader}, hasItems=${hasItems}`);
        if (!(hasProfileFilmsList && hasKinopoiskHeader && hasItems)) {
            console.warn(`[htmlParsingService] File #${idx + 1} is not a valid Kinopoisk ratings/watched films page. Skipping.`);
            return;
        }
        items.each((_, el) => {
            const idStr = $(el).attr('data-id');
            if (idStr && /^\d+$/.test(idStr)) {
                allIds.push(Number(idStr));
            }
        });
    });
    console.log('[htmlParsingService] function end');
    return allIds;
}
