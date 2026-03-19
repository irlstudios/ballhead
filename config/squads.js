'use strict';

const mascotSquads = Object.freeze([
    Object.freeze({ name: 'Duck Squad', roleId: '1359614680615620608' }),
    Object.freeze({ name: 'Pumpkin Squad', roleId: '1361466564292907060' }),
    Object.freeze({ name: 'Snowman Squad', roleId: '1361466801443180584' }),
    Object.freeze({ name: 'Gorilla Squad', roleId: '1361466637261471961' }),
    Object.freeze({ name: 'Bee Squad', roleId: '1361466746149666956' }),
    Object.freeze({ name: 'Alligator Squad', roleId: '1361466697059664043' }),
]);

const compSquadLevelRoles = Object.freeze([
    '1288918067178508423',
    '1288918165417365576',
    '1288918209294237707',
    '1288918281343733842',
]);

const contentSquadLevelRoles = Object.freeze([
    '1291090496869109762',
    '1291090569346682931',
    '1291090608315699229',
    '1291090760405356708',
]);

function getSquadTypeRoles(squadType) {
    if (squadType === 'Competitive') return compSquadLevelRoles;
    if (squadType === 'Content') return contentSquadLevelRoles;
    return [];
}

function findMascotByName(eventSquadName) {
    return mascotSquads.find(m => m.name === eventSquadName) || null;
}

module.exports = {
    mascotSquads,
    compSquadLevelRoles,
    contentSquadLevelRoles,
    getSquadTypeRoles,
    findMascotByName,
};
