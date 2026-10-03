'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { LENGTH_CHOICES, lengthLabel } = require('../../utils/emh_schedule');
const { execute, autocomplete } = require('../../handlers/emh_schedule');

const dayOption = (option) => option
    .setName('day')
    .setDescription('Day this week (Central time)')
    .setAutocomplete(true)
    .setRequired(true);
const timeOption = (option) => option
    .setName('time')
    .setDescription('Start time, like 7PM or 7:30PM (Central time)')
    .setMaxLength(10)
    .setRequired(true);
const lengthOption = (option) => option
    .setName('length')
    .setDescription('How long the slot blocks the calendar')
    .addChoices(...LENGTH_CHOICES.map((minutes) => ({ name: lengthLabel(minutes), value: minutes })));
const slotOption = (option) => option
    .setName('slot')
    .setDescription('The booking to change')
    .setAutocomplete(true)
    .setRequired(true);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('emh')
        .setDescription('Book and manage EMH event slots for this week')
        .addSubcommand((sub) => sub
            .setName('schedule')
            .setDescription('Book an event slot this week')
            .addStringOption(dayOption)
            .addStringOption(timeOption)
            .addIntegerOption(lengthOption))
        .addSubcommand((sub) => sub
            .setName('reschedule')
            .setDescription('Move one of your booked slots')
            .addStringOption(slotOption)
            .addStringOption(dayOption)
            .addStringOption(timeOption)
            .addIntegerOption(lengthOption))
        .addSubcommand((sub) => sub
            .setName('cancel')
            .setDescription('Cancel one of your booked slots')
            .addStringOption(slotOption))
        .addSubcommand((sub) => sub
            .setName('list')
            .setDescription('See every slot booked this week')),
    execute,
    autocomplete,
};
