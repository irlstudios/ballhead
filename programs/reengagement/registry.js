'use strict';

const { assertAdapter } = require('./adapters/program_adapter');
const ffAdapter = require('./adapters/ff_adapter');

// Registered program adapters, keyed by their stable id. Add future programs
// (Squads, Content Creator, ...) here as their adapters are built.
const adapters = new Map();

const register = (adapter) => {
    assertAdapter(adapter);
    adapters.set(adapter.id, adapter);
};

register(ffAdapter);

const getAdapter = (id) => adapters.get(id) || null;
const getAdapters = () => [...adapters.values()];

module.exports = { getAdapter, getAdapters, register };
