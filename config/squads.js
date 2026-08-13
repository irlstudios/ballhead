'use strict';

const mascotSquads = Object.freeze([
    Object.freeze({ name: 'Duck Squad', roleId: '1359614680615620608' }),
    Object.freeze({ name: 'Pumpkin Squad', roleId: '1361466564292907060' }),
    Object.freeze({ name: 'Snowman Squad', roleId: '1361466801443180584' }),
    Object.freeze({ name: 'Gorilla Squad', roleId: '1361466637261471961' }),
    Object.freeze({ name: 'Bee Squad', roleId: '1361466746149666956' }),
    Object.freeze({ name: 'Alligator Squad', roleId: '1361466697059664043' }),
]);

function findMascotByName(eventSquadName) {
    return mascotSquads.find(m => m.name === eventSquadName) || null;
}

module.exports = {
    mascotSquads,
    findMascotByName,
};
