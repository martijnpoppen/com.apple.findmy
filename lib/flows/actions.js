exports.init = async function (homey) {
    const send_message = homey.flow.getActionCard('send_message');
    send_message.registerRunListener(async (args, state) => {
        await args.device.onCapability_ACTION({'send_message': {"text": args.text, "subject": args.subject}});
    });

    const send_sound = homey.flow.getActionCard('send_sound');
    send_sound.registerRunListener(async (args, state) => {
        await args.device.onCapability_ACTION({'send_sound': {}});
    });

    const set_interval = homey.flow.getActionCard('set_interval');
    set_interval.registerRunListener(async (args, state) => {
        await args.device.onCapability_ACTION({'set_interval': {"interval": args.interval}});
    });
};