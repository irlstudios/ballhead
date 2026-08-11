'use strict';

const { SlashCommandBuilder, ContainerBuilder, MessageFlags, ChannelType } = require('discord.js');
const { buildTextBlock } = require('../../utils/ui');
const { speak } = require('../../utils/voice_tts');

const reply = (interaction, body) => {
    const container = new ContainerBuilder();
    const block = buildTextBlock(body);
    if (block) container.addTextDisplayComponents(block);
    return interaction.deferred
        ? interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] })
        : interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container],
        });
};

const FAILURE_LINES = {
    unconfigured: 'Text-to-speech is not configured on the host (PIPER_BIN / PIPER_MODEL).',
    busy: 'The bot is already speaking; try again in a moment.',
    'capturing-elsewhere': 'The bot is capturing a live event in another channel and cannot leave it.',
    'stage-suppressed': 'The bot joined the stage but could not become a speaker. Give it Mute Members on that stage channel.',
    failed: 'Speech synthesis failed; check the bot log.',
};

// https://discord.com/channels/<guild>/<channel>/<message>, plus the ptb,
// canary, and legacy discordapp.com hosts the client also copies.
const MESSAGE_LINK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)$/;

const parseMessageLink = (link) => {
    const match = MESSAGE_LINK.exec((link || '').trim());
    return match ? { guildId: match[1], channelId: match[2], messageId: match[3] } : null;
};

// Reply to and/or react to the message a link points at. Assumes the link was
// validated and the interaction deferred.
const actOnLinkedMessage = async ({ interaction, target, text, emoji, subtitle }) => {
    let message;
    try {
        const linkChannel = await interaction.client.channels.fetch(target.channelId);
        message = await linkChannel.messages.fetch(target.messageId);
    } catch {
        return reply(interaction, {
            title: 'Message Not Found', subtitle,
            lines: ['Could not fetch that message; check the link and that the bot can read that channel.'],
        });
    }
    if (text) {
        try {
            await message.reply(text);
        } catch (error) {
            return reply(interaction, {
                title: 'Cannot Reply', subtitle,
                lines: [`Could not reply in **${message.channel.name}**: ${error.message}`],
            });
        }
    }
    if (emoji) {
        try {
            await message.react(emoji.trim());
        } catch {
            return reply(interaction, {
                title: 'Cannot React', subtitle,
                lines: [
                    `**${emoji}** did not work as a reaction; use a standard emoji or one from this server.`,
                    ...(text ? ['The reply itself was posted.'] : []),
                ],
            });
        }
    }
    const did = [text && 'Replied', emoji && 'Reacted'].filter(Boolean).join(' & ');
    return reply(interaction, { title: did, subtitle, lines: [`${did} in **${message.channel.name}**.`] });
};

module.exports = {
    // Deliberately nonsense name. Discord cannot hide a command from the
    // picker per user id (default_member_permissions is permission-based and
    // would hide it from the non-admin owner too), so the command stays
    // visible and the owner-id check in execute is the sole gate.
    data: new SlashCommandBuilder()
        .setName('zzqvx')
        .setDescription('Make the bot speak in voice or post in a text channel (bot owner only).')
        .addStringOption((option) =>
            option.setName('text').setDescription('What to say (optional when only reacting)').setMaxLength(300))
        .addChannelOption((option) =>
            option.setName('channel').setDescription('Voice/stage to speak in, or text channel to post in (defaults to your voice channel)')
                .addChannelTypes(
                    ChannelType.GuildVoice, ChannelType.GuildStageVoice,
                    ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption((option) =>
            option.setName('message_link').setDescription('Message link to reply to (with text) and/or react to (with reaction)'))
        .addStringOption((option) =>
            option.setName('reaction').setDescription('Emoji to react with; needs message_link')),
    parseMessageLink,
    async execute(interaction) {
        const subtitle = 'Bot Voice';
        // Fail closed: no BOT_OWNER_ID configured means nobody may use it.
        if (!process.env.BOT_OWNER_ID || interaction.user.id !== process.env.BOT_OWNER_ID) {
            return reply(interaction, {
                title: 'Access Denied', subtitle,
                lines: ['Only the bot owner can use this command.'],
            });
        }
        const text = interaction.options.getString('text');
        const emoji = interaction.options.getString('reaction');
        const link = interaction.options.getString('message_link');
        if (!text && !emoji) {
            return reply(interaction, {
                title: 'Nothing To Do', subtitle,
                lines: ['Give text to say, or a reaction emoji plus a message_link.'],
            });
        }
        if (emoji && !link) {
            return reply(interaction, {
                title: 'Link Required', subtitle,
                lines: ['A reaction needs message_link pointing at the message to react to.'],
            });
        }
        if (link) {
            const target = parseMessageLink(link);
            if (!target) {
                return reply(interaction, {
                    title: 'Bad Link', subtitle,
                    lines: ['That does not look like a Discord message link.'],
                });
            }
            if (target.guildId !== interaction.guildId) {
                return reply(interaction, {
                    title: 'Wrong Server', subtitle,
                    lines: ['That message link points outside this server.'],
                });
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return actOnLinkedMessage({ interaction, target, text, emoji, subtitle });
        }
        const channel = interaction.options.getChannel('channel') || interaction.member.voice.channel;
        if (!channel) {
            return reply(interaction, {
                title: 'Channel Required', subtitle,
                lines: ['Join a voice channel or pass the channel option.'],
            });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
            try {
                await channel.send(text);
            } catch (error) {
                return reply(interaction, {
                    title: 'Cannot Post', subtitle,
                    lines: [`Could not post in **${channel.name}**: ${error.message}`],
                });
            }
            return reply(interaction, { title: 'Posted', subtitle, lines: [`Posted it in **${channel.name}**.`] });
        }
        const result = await speak({ channel, text });
        if (!result.ok) {
            return reply(interaction, { title: 'Cannot Speak', subtitle, lines: [FAILURE_LINES[result.reason]] });
        }
        return reply(interaction, { title: 'Spoken', subtitle, lines: [`Said it in **${channel.name}**.`] });
    },
};
