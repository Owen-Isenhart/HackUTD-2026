const expoCli = require.resolve('expo/bin/cli');

// Encode the Expo Go URL directly in the QR code, bypassing the browser chooser.
process.env.EXPO_NO_REDIRECT_PAGE = '1';
process.argv.splice(1, 1, expoCli, 'start', '--go');
require(expoCli);
