try {
    const integrations = require('./integrations/index.js');
    console.log("Successfully loaded integrations/index.js");
} catch (error) {
    console.error("FAILED to load integrations/index.js");
    console.error(error);
}
