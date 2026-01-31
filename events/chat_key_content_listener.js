const fetch = require('node-fetch');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const ITEM_URL_RE = /https?:\/\/(?:www\.)?ballhead\.app\/items\/([0-9a-f-]{36})/i;
console.log('[UGC-LISTENER] module loaded');

const monitored = ['1397239932833103894'];
const endpoint = 'https://api.ballhead.app/v1/private/gym-class-item-category/{id}/gallary/discord';
// Reactions temporarily disabled

async function notifyAndDelete(message) {
    console.log('[UGC-LISTENER] notifyAndDelete', message.id);
    try {
        const noticeContainer = new ContainerBuilder();
        noticeContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Missing Item Link'));
        noticeContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent([
            'Please include the item link from ballhead.app with your screenshot.',
            'Steps:',
            '1. Visit https://ballhead.app/items',
            '2. Find the item you want to post',
            '3. Click the item',
            '4. Use the link icon to copy the URL'
        ].join('\n')));
        await message.author.send({ flags: MessageFlags.IsComponentsV2, components: [noticeContainer] });
    } catch (error) {
        console.error('[UGC-LISTENER] failed to DM user about missing item link:', error);
    }
    try {
        await message.delete();
    } catch (error) {
        console.error('[UGC-LISTENER] failed to delete message after notification:', error);
    }
}


module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        if (monitored.includes(message.channelId)) {
            console.log('[UGC-LISTENER] execute fired', message.id, message.channelId);
            console.log('[UGC-LISTENER] prechecks', {
			  bot: message.author.bot,
			  channelOk: true,
			  attachments: message.attachments.size,
			  contentLen: (message.content || '').length
            });
        }
        if (message.author.bot) return;
        if (!monitored.includes(message.channelId)) return;
        if (!message.content || message.attachments.size === 0) {
		  console.log('[UGC-LISTENER] missing content or attachments', message.id);
		  await notifyAndDelete(message);
		  return;
        }

        // hookReactionHandlers(message.client)

        const attachment = message.attachments.first();
        if (!attachment) {
		  console.log('[UGC-LISTENER] no attachment object', message.id);
		  await notifyAndDelete(message);
		  return;
        }
        const isImage = (attachment.contentType && attachment.contentType.startsWith('image/')) || /\.(png|jpe?g|gif|webp)$/i.test(attachment.url);
        if (!isImage) {
		  console.log('[UGC-LISTENER] attachment not image', message.id, attachment.contentType, attachment.url);
		  await notifyAndDelete(message);
		  return;
        }

        const match = ITEM_URL_RE.exec(message.content);
        if (!match) {
            console.log('[UGC-LISTENER] no item link found', message.id);
            await notifyAndDelete(message);
            return;
        }
        const itemId = match[1];

        const payload = {
            guild_id: message.guildId,
            channel_id: message.channelId,
            message_id: message.id,
            discord_id: message.author.id,
            username: message.author.username,
            avatar: message.author.avatar || '',
            text: message.content,
            image_url: attachment.url
        };

        let res;
        try {
            res = await fetch(endpoint.replace('{id}', itemId), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            console.log('[UGC-LISTENER] fetch error', e?.message);
            await notifyAndDelete(message);
            return;
        }
        if (!res) {
            console.log('[UGC-LISTENER] bad response: no response object');
            return;
        }
        if (res.status >= 400) {
            let bodyText = null;
            try {
                bodyText = await res.text();
            } catch (error) {
                console.error('[UGC-LISTENER] failed to read error body:', error);
            }
            console.log('[UGC-LISTENER] bad response', res.status, bodyText);
            return;
        }

        let data;
        try {
            data = await res.json();
        } catch (e) {
            console.log('[UGC-LISTENER] json parse error', e?.message);
            return;
        }
        if (data.status === 'rejected') {
            console.log('[UGC-LISTENER] rejected', message.id, data.reason);
            try {
                await message.delete();
            } catch (error) {
                console.error('[UGC-LISTENER] failed to delete rejected message:', error);
            }
            return;
        }
        if (data.status === 'accepted') {
            console.log('[UGC-LISTENER] accepted', message.id);
        }
    }
};
