// Parse config.
require('dotenv').config();

const debug = require('debug')('devkat:routes:raw_data');
const pokemon_debug = require('debug')('devkat:db:pokemon');

const errors = require('restify-errors');
const corsMiddleware = require('restify-cors-middleware');

const utils = require('../inc/utils.js');
const blacklist = require('../inc/blacklist.js');

const Pokemon = require('../models/Pokemon');
const Pokestop = require('../models/Pokestop');
const Gym = require('../models/Gym');
const Weather = require('../models/Weather');
const ScannedLocation = require('../models/ScannedLocation');
const Spawnpoint = require('../models/Spawnpoint')

/* Readability. */
const isEmpty = utils.isEmpty;
const isUndefined = utils.isUndefined;


/* Settings. */
const ROUTE_RAW_DATA = process.env.ROUTE_RAW_DATA || '/raw_data';
const CORS_WHITELIST = process.env.CORS_WHITELIST || '';


/* CORS. */
const whitelist = CORS_WHITELIST.split(',');
const cors = corsMiddleware({
    origins: whitelist
});


/* Helpers. */

// Query is a combination of partials. When all completed, return response.
function partialCompleted(pokemon, pokestops, gyms, weather, weather_alerts, grid, scanned, spawnpoints, res, response) {
    if (pokemon && pokestops && gyms && weather && weather_alerts && grid && scanned && spawnpoints) {
        debug('Sending response.');
        return res.json(response);
    }
}

function queryHasRequiredParams(query, requiredParams) {
    for (let i = 0; i < requiredParams.length; i++) {
        let item = requiredParams[i];

        // Missing or empty parameter, bad request.
        if (!query.hasOwnProperty(item) || isEmpty(item)) {
            return false;
        }
    }

    return true;
}

function parseGetParam(param, defaultVal) {
    // Undefined?
    if (isEmpty(param)) {
        return defaultVal;
    }

    // Ok, we have a value.
    var val = param;

    // Truthy/falsy strings?
    if (val === 'true') {
        return true;
    } else if (val === 'false') {
        return false;
    }

    // Make sure single values adhere to defaultVal type.
    if (defaultVal instanceof Array && typeof val === 'string') {
        val = [val];
    }

    // No empty values should be left over.
    if (val instanceof Array) {
        for (let i = 0; i < val.length; i++) {
            let item = val[i];

            // Remove empty item.
            if (item.length === 0) {
                val = val.splice(i, 1);
            }
        }
    }

    // Numbers should be converted back to numeric types.
    // Don't use parseInt() for numeric checking, use parseFloat() instead.
    if (utils.isNumeric(val)) {
        val = parseFloat(val);
    }

    // Rest is good to go.
    return val;
}

// Node.js.
module.exports = (server) => {
    // CORS middleware.
    server.pre(cors.preflight);
    server.use(cors.actual);


    /* Route. */

    server.get(ROUTE_RAW_DATA, (req, res, next) => {
        let data = req.params || {};

        debug('Request to %s from %s.', ROUTE_RAW_DATA, req.connection.remoteAddress);


        /* Verify request. */

        // Don't allow blacklisted fingerprints.
        const fingerprints = Object.keys(blacklist);

        for (var i = 0; i < fingerprints.length; i++) {
            const key = fingerprints[i];
            const fingerprint = blacklist[key];

            if (fingerprint(req)) {
                return next(
                    new errors.ForbiddenError('Blacklisted fingerprint.')
                );
            }
        }

        // Make sure we have all required parameters for a correct request.
        const required = [
            'swLat', 'swLng', 'neLat', 'neLng',
            /*'oSwLat', 'oSwLng', 'oNeLat', 'oNeLng'*/
        ];

        // Bad request.
        if (!queryHasRequiredParams(data, required)) {
            return next(
                new errors.ForbiddenError('Invalid parameters.')
            );
        }


        /* Parse GET params. */

        // Show/hide.
        const no_pokemon = parseGetParam(data.no_pokemon, false);
        const no_pokestops = parseGetParam(data.no_pokestops, false);
        const no_gyms = parseGetParam(data.no_gyms, false);

        //parse current settings
        const show_pokemon = parseGetParam(data.pokemon, true) && !no_pokemon;
        const show_pokestops = parseGetParam(data.pokestops, true) && !no_pokestops;
        const show_gyms = parseGetParam(data.gyms, true) && !no_gyms;

        const show_weather = parseGetParam(data.weather, false);
        const show_weather_grid = parseGetParam(data.s2cells, false);
        const show_weather_alerts = parseGetParam(data.weatherAlerts, false);

        const show_scanned_locations = parseGetParam(data.scanned, false);
        const show_spawnpoints = parseGetParam(data.spawnpoints, false);

        // Previous switch settings.
        const last_gyms = parseGetParam(data.lastgyms, false);
        const last_pokestops = parseGetParam(data.lastpokestops, false);
        const last_pokemon = parseGetParam(data.lastpokemon, false);
        const last_scanned_locations = parseGetParam(data.lastslocs, false);
        const last_spawnpoints = parseGetParam(data.lastspawns, false);

        // Locations.
        const swLat = parseGetParam(data.swLat, undefined);
        const swLng = parseGetParam(data.swLng, undefined);
        const neLat = parseGetParam(data.neLat, undefined);
        const neLng = parseGetParam(data.neLng, undefined);
        const oSwLat = parseGetParam(data.oSwLat, undefined);
        const oSwLng = parseGetParam(data.oSwLng, undefined);
        const oNeLat = parseGetParam(data.oNeLat, undefined);
        const oNeLng = parseGetParam(data.oNeLng, undefined);

        // TODO: Check distance in locations. If it exceeds a certain distance,
        // refuse the query.

        // Other.
        const spawnpoints = parseGetParam(data.spawnpoints, false);
        var timestamp = parseGetParam(data.timestamp, undefined);
        const prionotify = parseGetParam(data.prionotify, false);

        // Convert to usable date object.
        if (!isEmpty(timestamp)) {
            debug('Request for timestamp %s.', timestamp);
            timestamp = new Date(timestamp);
        }

        // Query response is a combination of Pokémon + Pokéstops + Gyms, so
        // we have to wait until the necessary Promises have completed.
        var completed_pokemon = !show_pokemon;
        var completed_pokestops = !show_pokestops;
        var completed_gyms = !show_gyms;
        var completed_weather = !show_weather;
        var completed_weather_alerts = !show_weather_alerts;
        var completed_weather_grid = !show_weather_grid;
        var completed_scanned_locations = !show_scanned_locations;
        var completed_spawnpoints = !show_spawnpoints;

        // General/optional.
        // TODO: Check if "lured_only" is proper var name.
        const lured_only = parseGetParam(data.luredonly, true);

        var new_area = false; // Did we zoom in/out?

        if (!isEmpty(oSwLat) && !isEmpty(oSwLng) && !isEmpty(oNeLat) && !isEmpty(oNeLng)) {
            // We zoomed in, no new area uncovered.
            if (oSwLng < swLng && oSwLat < swLat && oNeLat > neLat && oNeLng > neLng) {
                new_area = false;
            } else if (!(oSwLat === swLat && oSwLng === swLng && oNeLat === neLat && oNeLng === neLng)) {
                new_area = true; // We moved.
            }
        }


        /* Prepare response. */
        var response = {};

        // UTC timestamp.
        response.timestamp = Date.now();

        // Values for next request.
        response.lastgyms = show_gyms;
        response.lastpokestops = show_pokestops;
        response.lastpokemon = show_pokemon;
        response.lastslocs = show_scanned_locations;
        response.lastspawns = show_spawnpoints;

        // Pass current coords as old coords.
        response.oSwLat = swLat;
        response.oSwLng = swLng;
        response.oNeLat = neLat;
        response.oNeLng = neLng;

        // Handle Pokémon.
        if (show_pokemon) {
            // Pokémon IDs, whitelist or blacklist.
            let ids = [];
            let excluded = [];

            if (!isEmpty(data.ids)) {
                ids = parseGetParam(data.ids.split(','), []);
            }
            if (prionotify == false && !isEmpty(data.eids)) {
                excluded = parseGetParam(data.eids.split(','), []);
            }
            if (!isEmpty(data.reids)) {
                // TODO: Check this implementation of reids. In original, it's
                // separate to other query types.
                let reids = parseGetParam(data.reids.split(','), []);
                ids += reids;
                response.reids = reids;
            }

            // TODO: Change .then() below w/ custom "completed" flags into proper
            // Promise queue.

            // Completion handler.
            let foundMons = (pokes) => {
                response.pokemons = pokes;
                completed_pokemon = true;

                pokemon_debug('Found %s relevant Pokémon results.', pokes.length);
                return partialCompleted(completed_pokemon, completed_pokestops, completed_gyms, completed_weather, completed_weather_alerts, completed_weather_grid, completed_scanned_locations, completed_spawnpoints, res, response);
            };

            // TODO: Rewrite below workflow. We reimplemented the old Python code,
            // but it's kinda ugly.

            // Whitelist query?
            if (ids.length > 0) {
                // Run query async.
                Pokemon.get_active_by_ids(ids, excluded, swLat, swLng, neLat, neLng).then(foundMons).catch(utils.handle_error);
            } else if (!last_pokemon) {
                // First query from client?
                Pokemon.get_active(null, swLat, swLng, neLat, neLng).then(foundMons).catch(utils.handle_error);
            } else {
                // If map is already populated only request modified Pokémon
                // since last request time.
                Pokemon.get_active(excluded, swLat, swLng, neLat, neLng, timestamp).then((pokes) => {
                    // If screen is moved add newly uncovered Pokémon to the
                    // ones that were modified since last request time.
                    if (new_area) {
                        debug('Request for new viewport.');

                        Pokemon.get_active(excluded, swLat, swLng, neLat, neLng, null, oSwLat, oSwLng, oNeLat, oNeLng).then((new_pokes) => {
                            // Add the new ones to the old result and pass to handler.
                            return foundMons(pokes.concat(new_pokes));
                        }).catch(utils.handle_error);
                    } else {
                        // Unchanged viewport.
                        return foundMons(pokes);
                    }
                }).catch(utils.handle_error);
            }

            // TODO: On first visit, send in-memory data for viewport.
        }

        // Handle Pokéstops.
        if (show_pokestops) {
            // Completion handler.
            let foundPokestops = function (stops) {
                response.pokestops = stops;
                completed_pokestops = true;

                return partialCompleted(completed_pokemon, completed_pokestops, completed_gyms, completed_weather, completed_weather_alerts, completed_weather_grid, completed_scanned_locations, completed_spawnpoints, res, response);
            };

            // First query from client?
            if (!last_pokestops) {
                Pokestop.get_stops(swLat, swLng, neLat, neLng, lured_only).then(foundPokestops).catch(utils.handle_error);
            } else {
                // If map is already populated only request modified Pokéstops
                // since last request time.
                Pokestop.get_stops(swLat, swLng, neLat, neLng, lured_only, timestamp).then(function (pokestops) {
                    // If screen is moved add newly uncovered Pokéstops to the
                    // ones that were modified since last request time.
                    if (new_area) {
                        Pokestop.get_stops(swLat, swLng, neLat, neLng, lured_only, null, oSwLat, oSwLng, oNeLat, oNeLng).then(function (new_pokestops) {
                            // Add the new ones to the old result and pass to handler.
                            return foundPokestops(pokestops.concat(new_pokestops));
                        }).catch(utils.handle_error);
                    } else {
                        // Unchanged viewport.
                        return foundPokestops(pokestops);
                    }
                }).catch(utils.handle_error);
            }
        }

        // Handle gyms.
        if (show_gyms) {
            // Completion handler.
            let foundGyms = (gyms) => {
                // RM uses an object w/ gym_id as keys. Can't remember why, this might be a case of "old code".
                // TODO: Look at RM's code for this and optimize.
                const gyms_obj = {};

                while (gyms.length > 0) {
                    const gym = gyms.pop();

                    // Attach to result object.
                    gyms_obj[gym.gym_id] = gym;
                }

                response.gyms = gyms_obj;
                completed_gyms = true;

                return partialCompleted(completed_pokemon, completed_pokestops, completed_gyms, completed_weather, completed_weather_alerts, completed_weather_grid, completed_scanned_locations, completed_spawnpoints, res, response);
            };

            // First query from client?
            if (!last_gyms) {
                Gym.get_gyms(swLat, swLng, neLat, neLng).then(foundGyms).catch(utils.handle_error);
            } else {
                // If map is already populated only request modified Gyms
                // since last request time.
                Gym.get_gyms(swLat, swLng, neLat, neLng, timestamp).then((gyms) => {
                    // If screen is moved add newly uncovered Gyms to the
                    // ones that were modified since last request time.
                    if (new_area) {
                        Gym.get_gyms(swLat, swLng, neLat, neLng, null, oSwLat, oSwLng, oNeLat, oNeLng).then((new_gyms) => {
                            // Add the new ones to the old result and pass to handler.
                            return foundGyms(gyms.concat(new_gyms));
                        }).catch(utils.handle_error);
                    } else {
                        // Unchanged viewport.
                        return foundGyms(gyms);
                    }
                }).catch(utils.handle_error);
            }
        }

        //handle weather
        if (show_weather_alerts) {
            let foundWeatherAlerts = (weatherAlerts) => {

                response.weatherAlerts = weatherAlerts;
                completed_weather_alerts = true;
                //debug('Found %s cells with weather alerts.', weatherAlerts.length);
                return partialCompleted(completed_pokemon, completed_pokestops, completed_gyms, completed_weather, completed_weather_alerts, completed_weather_grid, completed_scanned_locations, completed_spawnpoints, res, response);
            };

            Weather.get_weather(true).then(foundWeatherAlerts).catch(utils.handle_error);


            /*Alternative: don't use promises and just get it in a serial manner
            response.weatherAlerts = Weather.get_latest_alerts();
            debug('Received %s cells with weather alerts', response.weatherAlerts.length);
            completed_weather_alerts = true;
            partialCompleted(completed_pokemon, completed_pokestops, completed_gyms, completed_weather, completed_weather_alerts, res, response);
            */
        }

        //handle grid view
        if (show_weather_grid) {
            let foundGrid = (newGrid) => {

                response.s2cells = newGrid;
                completed_weather_grid = true;
                //debug('Found %s cells for the grid.', newGrid.length);
                return partialCompleted(completed_pokemon, completed_pokestops, completed_gyms, completed_weather, completed_weather_alerts, completed_weather_grid, completed_scanned_locations, completed_spawnpoints, res, response);
            };

            Weather.get_grid().then(foundGrid).catch(utils.handle_error);
        }

        //handle weather
        if (show_weather) {

            let foundWeather = (weather) => {

                response.weather = weather;
                completed_weather = true;
                //debug('Received %s cells with weatherinfo', response.weather.length);
                return partialCompleted(completed_pokemon, completed_pokestops, completed_gyms, completed_weather, completed_weather_alerts, completed_weather_grid, completed_scanned_locations, completed_spawnpoints, res, response);
            };

            Weather.get_weather(false).then(foundWeather).catch(utils.handle_error);

            /*Alternative: don't use promises and just get it in a serial manner
            response.weather = Weather.get_latest();
            debug('Received %s cells with weatherinfo', response.weather.length);
            completed_weather = true;
            partialCompleted(completed_pokemon, completed_pokestops, completed_gyms, completed_weather, completed_weather_alerts, res, response);
            */
        }

        // Handle scannedlocations
        if (show_scanned_locations) {
            // Completion handler.
            let foundScannedLocations = function (locations) {
                response.scanned = locations;
                completed_scanned_locations = true;

                return partialCompleted(completed_pokemon, completed_pokestops, completed_gyms, completed_weather, completed_weather_alerts, completed_weather_grid, completed_scanned_locations, completed_spawnpoints, res, response);
            };

            // First query from client?
            if (!last_scanned_locations) {
                ScannedLocation.get_locations(swLat, swLng, neLat, neLng).then(foundScannedLocations).catch(utils.handle_error);
            } else {
                // If map is already populated only request modified locations
                // since last request time.
                if (new_area) {
                    ScannedLocation.get_locations(swLat, swLng, neLat, neLng, null, oSwLat, oSwLng, oNeLat, oNeLng).then(foundScannedLocations).catch(utils.handle_error);
                } else {
                    // Unchanged viewport.
                    ScannedLocation.get_locations(swLat, swLng, neLat, neLng, timestamp).then(foundScannedLocations).catch(utils.handle_error);
                }
            }
        }

        if (show_spawnpoints) {
            // Completion handler.
            let foundSpawnpoints = function (spawnpoints) {
                response.spawnpoints = spawnpoints;
                completed_spawnpoints = true;

                return partialCompleted(completed_pokemon, completed_pokestops, completed_gyms, completed_weather, completed_weather_alerts, completed_weather_grid, completed_scanned_locations, completed_spawnpoints, res, response);
            };

            // First query from client?
            if (!last_spawnpoints) {
                Spawnpoint.get_locations(swLat, swLng, neLat, neLng).then(foundSpawnpoints).catch(utils.handle_error);
            } else {
                // If map is already populated only request modified locations
                // since last request time.
                if (new_area) {
                    Spawnpoint.get_locations(swLat, swLng, neLat, neLng, null, oSwLat, oSwLng, oNeLat, oNeLng).then(foundSpawnpoints).catch(utils.handle_error);
                } else {
                    // Unchanged viewport.
                    Spawnpoint.get_locations(swLat, swLng, neLat, neLng, timestamp).then(foundSpawnpoints).catch(utils.handle_error);
                }
            }
        }

        // A request for nothing?
        if (!show_pokemon && !show_pokestops && !show_gyms && !show_weather && !show_weather_alerts && !show_weather_grid && !show_scanned_locations && !show_spawnpoints) {
            //debug('Sending response. Shouldn\'t really be anything....');
            return res.json(response);
        }
    });
};
