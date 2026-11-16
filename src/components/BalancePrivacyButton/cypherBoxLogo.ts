/**
 * The CypherBox logo from the app icon (the masked face under its halo) as SVG path data, traced from the 1024 px
 * icon. It is CYPHERBOX_LOGO_WIDTH units wide and CYPHERBOX_LOGO_HEIGHT tall. Draw it with fillRule "evenodd" so the
 * inner outlines cut holes.
 */
export const CYPHERBOX_LOGO_WIDTH = 100;
export const CYPHERBOX_LOGO_HEIGHT = 72.8;

/** The mask with its hair and halo, and the dark crown inside the halo cut out of it. */
export const CYPHERBOX_LOGO_BODY = [
    // outline
    'M30 0.1 L39.5 0.1 L50 1.5 L60 3.7 L70.2 7.2 L76.5 10.4 L81.5 13.5 L85.8 17 L90.3 21.9 L91.2 21.8 L94.5 18.8',
    'L94.8 20.9 L94.4 26.4 L94.7 27 L95.2 26.8 L96.4 25.7 L99.7 21.8 L100 24 L99 32.4 L98.3 33.8 L95.2 37.3',
    'L94.6 41.6 L94.5 43 L94.9 43.4 L97.6 41.7 L97.8 43.4 L97.2 48.1 L94.2 51.7 L90.7 57.6 L87.6 60.8 L84.3 63.2',
    'L80.6 64.7 L76.9 65.4 L73.8 65.3 L70.9 64.3 L68.3 62.8 L66 60.4 L63.6 56.7 L63 56.4 L60.3 61 L58.4 63.7',
    'L56.5 65.6 L53.1 68.3 L49.2 70.4 L46.3 71.4 L40.8 72.8 L37.5 72.8 L31.9 71.3 L27.6 69.4 L23.2 66 L19.8 62.4',
    'L14.2 59.5 L13.6 57.2 L12.2 48.6 L12.6 48.3 L13.3 48.5 L17.4 50.6 L19.4 51.2 L19.5 49.9 L18.2 43.2 L17.5 42.1',
    'L10.5 37.6 L8.9 29 L4.5 25 L2.3 22.5 L0.6 19.4 L0 16.3 L1.3 13.1 L2.7 11.1 L5.8 8.3 L9.6 5.8 L13.9 3.7 L18.1 2.3',
    'L22.9 1.1 Z',
    // the crown inside the halo
    'M29.8 2.6 L41.2 2.6 L51.9 4.1 L63.9 7 L72.5 10.4 L78.6 13.8 L81.6 16 L84.9 18.8 L88.1 22.5 L88.6 23.7 L88.2 25.8',
    'L88 31.2 L85.3 32.1 L79.5 33.2 L65.4 34.8 L46.5 34.8 L36.4 34.1 L31.8 33.4 L31.1 32.8 L30.8 24.6 L18.8 15.5',
    'L18.5 15.7 L18.4 16.3 L19.5 25.5 L19.7 27.6 L19.4 28.2 L18.3 27.8 L16.3 26.5 L7.5 18.7 L7.3 19.7 L7.8 24.4',
    'L7.8 24.8 L7.1 24.8 L3.5 20.9 L2.7 19.3 L2.4 17.6 L2.9 14.2 L3.9 12.7 L5.3 11.3 L9.8 7.9 L16.1 5.1 L22.5 3.4 Z',
].join(' ');

/** The two eye holes. Leave them out and the eyes are filled. */
export const CYPHERBOX_LOGO_EYES = [
    // left eye
    'M31.9 44.2 L53.6 46.8 L54 47.5 L53.9 50.1 L52.8 53.8 L50.4 57.4 L48.8 58.7 L46.8 59.7 L42.9 60.5 L40.5 60.4',
    'L38.2 59.7 L34.9 57.5 L32.7 54.2 L31.5 49.5 L31.4 45.3 L31.6 44.3 Z',
    // right eye
    'M86.8 40.1 L87.7 40 L87.9 40.6 L87.3 46.9 L85.9 50.4 L84 52.9 L81.7 54.5 L79.5 55.1 L76.6 55 L74.3 53.7',
    'L73.1 52.3 L72.2 50.3 L71.6 46.9 L71.7 45.1 Z',
].join(' ');
