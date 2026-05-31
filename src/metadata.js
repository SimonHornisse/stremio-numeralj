const defaults = {
    genres: ['Science Fiction', 'Adventure', 'Fan Edit'],
    country: 'US',
    language: 'English',
    director: ['NumeralJ / Mecha Salesman'],
};

const metadata = {
    numeralj_1: {
        tagline: 'An expanded cut of the beginning of the Skywalker saga.',
        description: 'An extended edition of The Phantom Menace with deleted scenes restored and continuity-focused polish for a broader prequel trilogy experience.',
        releaseInfo: '1999 / Fan Edit',
        runtime: '143 min',
        theme: { primary: '#7a1f2b', secondary: '#d2a44d', accent: '#6cc6d9' },
    },
    numeralj_2: {
        tagline: 'The clone war begins with a longer path to Geonosis.',
        description: 'An extended Attack of the Clones edit restoring deleted scenes and smoothing the prequel trilogy flow.',
        releaseInfo: '2002 / Fan Edit',
        runtime: '150 min',
        theme: { primary: '#293f7a', secondary: '#b65b3f', accent: '#f0c36a' },
    },
    numeralj_3: {
        tagline: 'Revenge of the Sith and The Siege of Mandalore woven into one fall.',
        description: 'A supercut that combines Revenge of the Sith with the final Clone Wars arc to present Order 66, Anakin, Ahsoka, and Mandalore in one chronological feature.',
        releaseInfo: '2005 / Fan Edit',
        runtime: '250 min',
        theme: { primary: '#4d1118', secondary: '#e07b32', accent: '#4cc9f0' },
    },
    numeralj_4: {
        tagline: 'The 2003 micro-series re-shaped into four longer chapters.',
        description: 'Genndy Tartakovsky style Clone Wars action re-edited into feature-style episodes with 1080p and 4K HDR options.',
        releaseInfo: '2003 / Fan Edit',
        runtime: '4 episodes',
        theme: { primary: '#324a5f', secondary: '#e6b45a', accent: '#c83e4d' },
    },
    numeralj_5: {
        tagline: 'The Clone Wars rebuilt as a chronological film-cut saga.',
        description: 'The Clone Wars arcs collected into film-style chapters, standalone episodes, and bonus cuts for a more continuous viewing order.',
        releaseInfo: '2008-2020 / Fan Edit',
        runtime: '49 chapters',
        theme: { primary: '#23466d', secondary: '#f4a261', accent: '#84dcc6' },
    },
    numeralj_6: {
        tagline: 'Clone Force 99 condensed into seven feature-length missions.',
        description: 'The Bad Batch arranged into TV film cuts covering the full series arc from Aftermath through Tantiss and the finale.',
        releaseInfo: '2021-2024 / Fan Edit',
        runtime: '7 films',
        theme: { primary: '#1f2933', secondary: '#a83f39', accent: '#8ecae6' },
    },
    numeralj_7: {
        tagline: 'Maul returns from the shadows.',
        description: 'A feature cut centered on Maul and Shadow Lord material, packaged as a single season-length feature.',
        releaseInfo: 'Fan Edit',
        runtime: '1 feature',
        theme: { primary: '#22111f', secondary: '#c1121f', accent: '#fca311' },
    },
    numeralj_8: {
        tagline: 'A longer ride through the underworld.',
        description: 'Solo extended with deleted material restored for a fuller version of Han, Qi-ra, Beckett, and the Kessel run.',
        releaseInfo: '2018 / Fan Edit',
        runtime: 'Feature',
        theme: { primary: '#3a2f2a', secondary: '#d99058', accent: '#70a9a1' },
    },
    numeralj_9: {
        tagline: 'Kenobi reshaped as a single feature.',
        description: 'The Obi-Wan Kenobi series condensed into a feature cut focused on pace, character momentum, and cinematic continuity.',
        releaseInfo: '2022 / Fan Edit',
        runtime: '1 feature',
        theme: { primary: '#3f3b2f', secondary: '#c2a45d', accent: '#5dade2' },
    },
    numeralj_10: {
        tagline: 'The rebellion is assembled one film at a time.',
        description: 'Andor arranged into six film cuts, carrying the story from Ferrix and Aldhani through Ghorman and the rebel extraction.',
        releaseInfo: '2022-2025 / Fan Edit',
        runtime: '6 films',
        theme: { primary: '#263238', secondary: '#b08968', accent: '#80cbc4' },
    },
    numeralj_11: {
        tagline: 'The Ghost crew in a chaptered rebellion.',
        description: 'Star Wars Rebels reworked into film cuts and key standalone chapters from Lothal through the liberation arc.',
        releaseInfo: '2014-2018 / Fan Edit',
        runtime: '34 chapters',
        theme: { primary: '#213547', secondary: '#d65a31', accent: '#a7c957' },
    },
    numeralj_12: {
        tagline: 'A New Hope with Rogue One connective tissue.',
        description: 'The Rogue Cut bridges Rogue One and A New Hope into a longer Episode IV experience.',
        releaseInfo: '1977 / Fan Edit',
        runtime: 'Feature',
        theme: { primary: '#22223b', secondary: '#f2cc8f', accent: '#81b29a' },
    },
    numeralj_13: {
        tagline: 'The infamous holiday broadcast in 4K form.',
        description: 'A restored presentation of The Star Wars Holiday Special, included for completionists and historical curiosity.',
        releaseInfo: '1978 / Remaster',
        runtime: 'Special',
        theme: { primary: '#2f1b25', secondary: '#d62828', accent: '#fcbf49' },
    },
    numeralj_14: {
        tagline: 'Din Djarin, Grogu, Boba Fett, and Mandalore in four films.',
        description: 'The Mandalorian and The Book of Boba Fett combined into feature-length cuts following Grogu, Boba, and the return to Mandalore.',
        releaseInfo: '2019-2023 / Fan Edit',
        runtime: '4 films',
        theme: { primary: '#2d3436', secondary: '#9c6644', accent: '#a3b18a' },
    },
    numeralj_15: {
        tagline: 'Ahsoka condensed into one feature-length journey.',
        description: 'The Ahsoka series shaped into a feature cut centered on Sabine, Thrawn, Peridea, and the legacy of Rebels.',
        releaseInfo: '2023 / Fan Edit',
        runtime: '1 feature',
        theme: { primary: '#183a37', secondary: '#f77f00', accent: '#90e0ef' },
    },
    numeralj_16: {
        tagline: 'The Acolyte presented as a single mystery feature.',
        description: 'The Acolyte condensed into a feature cut focused on the central mystery, the twins, and the darker edge of the High Republic era.',
        releaseInfo: '2024 / Fan Edit',
        runtime: '1 feature',
        theme: { primary: '#211a2c', secondary: '#8d99ae', accent: '#e63946' },
    },
    numeralj_17: {
        tagline: 'Character-focused Tales recut into longer arcs.',
        description: 'Tales of the Jedi, Empire, and Underworld material arranged as character cuts for Dooku, Ahsoka, Morgan, Barriss, Ventress, and Cad Bane.',
        releaseInfo: '2022-2025 / Fan Edit',
        runtime: '6 cuts',
        theme: { primary: '#1b263b', secondary: '#778da9', accent: '#e0a458' },
    },
};

function getMeta(item) {
    const custom = metadata[item.id] || {};
    return {
        ...defaults,
        ...custom,
        genres: custom.genres || defaults.genres,
    };
}

module.exports = { getMeta };
