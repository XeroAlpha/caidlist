const {
    cachedOutput,
    forEachObject
} = require("../util/common");

const userTranslationStorageKey = {
    block: "translation.block",
    item: "translation.item",
    sound: "translation.sound",
    entity: "translation.entity",
    entityEvent: "translation.entity_event",
    entityFamily: "translation.entity_family",
    particleEmitter: "translation.particle_emitter",
    animation: "translation.animation",
    effect: "translation.effect",
    enchant: "translation.enchant",
    fog: "translation.fog",
    location: "translation.location",
    lootTable: "translation.lootTable"
};
function loadUserTranslation() {
    let userTranslation = {};
    forEachObject(userTranslationStorageKey, (v, k) => {
        userTranslation[k] = cachedOutput(v, () => new Object());
    });
    return userTranslation;
}

function saveUserTranslation(userTranslation) {
    forEachObject(userTranslationStorageKey, (v, k) => {
        cachedOutput(v, userTranslation[k]);
    });
}

module.exports = {
    loadUserTranslation,
    saveUserTranslation
}