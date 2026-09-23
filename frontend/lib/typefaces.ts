/* The typefaces plxr ships, and on what terms.
 *
 * Four of them have travelled inside every build from the beginning and were
 * named nowhere: the licences page listed the icon sets and not one letter
 * about the letters. Every one of these is under the SIL Open Font License,
 * which asks for exactly two things — that the copyright notice travels with
 * the files, and that the licence text does. The files are in the build under
 * /licenses/, the page reads them back and prints them whole, the same way it
 * does for the icons.
 *
 * A face is added here at the same time as its file, never after: the check
 * that reads this list against what is on disk is what keeps the two together.
 */
export interface Typeface {
  id: string;
  title: string;
  source: string;
  licence: string;
  licenceFile: string;
  file: string;
  usedFor: string;
}

export const TYPEFACES: Typeface[] = [
  {
    id: "ibm-plex-mono",
    title: "IBM Plex Mono",
    source: "https://github.com/IBM/plex",
    licence: "SIL OFL 1.1", // german-ok: the licence's name
    licenceFile: "licenses/ibm-plex-mono.txt",
    file: "fonts/ibm-plex-mono-400.woff2",
    usedFor: "The terminal and the editor, in every skin that does not bring its own",
  },
  {
    id: "caveat",
    title: "Caveat",
    source: "https://github.com/googlefonts/caveat",
    licence: "SIL OFL 1.1", // german-ok: the licence's name
    licenceFile: "licenses/caveat.txt",
    file: "fonts/caveat.woff2",
    usedFor: "The hand in the Sketch skin",
  },
  {
    id: "space-mono",
    title: "Space Mono",
    source: "https://github.com/googlefonts/spacemono",
    licence: "SIL OFL 1.1", // german-ok: the licence's name
    licenceFile: "licenses/space-mono.txt",
    file: "fonts/spacemono.woff2",
    usedFor: "The typewriter in the Sketch skin",
  },
  {
    id: "press-start-2p",
    title: "Press Start 2P",
    source: "https://github.com/google/fonts/tree/main/ofl/pressstart2p",
    licence: "SIL OFL 1.1", // german-ok: the licence's name
    licenceFile: "licenses/press-start-2p.txt",
    file: "fonts/pressstart.woff2",
    usedFor: "The lettering of the Pixel skin",
  },
  {
    id: "antonio",
    title: "Antonio",
    source: "https://github.com/googlefonts/antonioFont",
    licence: "SIL OFL 1.1", // german-ok: the licence's name
    licenceFile: "licenses/antonio.txt",
    file: "fonts/antonio.woff2",
    usedFor: "An ultra-compressed grotesque, for looks built on tall narrow capitals",
  },
];
