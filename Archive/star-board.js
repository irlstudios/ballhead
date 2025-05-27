module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user, client) {
    try {
      if (reaction.emoji.name !== '⭐') return;

      if (!reaction.message || !reaction.message.author) {
        console.error('Reaction message or author is undefined.');
        return;
      }

      if (reaction.message.author.bot) return;

      const guild = reaction.message.guild;
      if (!guild) {
        console.error('Reaction event occurred outside of a guild.');
        return;
      }

      const member = await guild.members.fetch(user.id).catch((err) => {
        console.error('Failed to fetch the member from guild:', err);
        return null;
      });
      if (!member) return;

      if (!member.roles.cache.has('805833778064130104')) return;

      const starboardChannel = await guild.channels.fetch('1197729183816749137').catch(err => {
        console.error('Failed to fetch the starboard channel:', err);
        return null;
      });
      if (!starboardChannel) return;

      const embed = createEmbed(reaction);

      await starboardChannel.send({ embeds: [embed] });
    } catch (error) {
      console.error('Error in starboard event:', error);
    }
  },
};

function createEmbed(reaction) {
  const embedTitle = getEmbedTitle(reaction.message);
  const embed = {
    title: embedTitle,
    description: reaction.message.content || '',
    fields: [
      {
        name: 'Message Link',
        value: `[Jump to Message](${reaction.message.url})`,
        inline: false,
      },
    ],
    author: {
      name: reaction.message.author.tag,
      icon_url: reaction.message.author.displayAvatarURL({ dynamic: true }),
    },
    timestamp: new Date(),
    color: 0xFFAC33,
  };

  const attachmentUrl = reaction.message.attachments.first()?.url;
  if (attachmentUrl) {
    embed.image = { url: attachmentUrl };
  }

  return embed;
}

function getEmbedTitle(message) {
  if (message.content && !message.attachments.size) {
    return 'Message below has been starred by a moderator!';
  } else if (!message.content && message.attachments.size === 1) {
    return 'Image below has been starred by a moderator!';
  } else if (message.content && message.attachments.size === 1) {
    return 'Message & Image below has been starred by a moderator!';
  }
  return '';
}
