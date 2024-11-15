const init = async function (homey) {
    const send_message = homey.flow.getActionCard('send_message');
    send_message.registerRunListener(async (args, state) => {
        homey.app.log('[Actions] - Send message');
        await args.device.onCapability_ACTION({'send_message': {"text": args.text, "subject": args.subject}});
    });

    const send_sound = homey.flow.getActionCard('send_sound');
    send_sound.registerRunListener(async (args, state) => {
        homey.app.log('[Actions] - Send sound');
        await args.device.onCapability_ACTION({'send_sound': {}});
    });

    const set_interval = homey.flow.getActionCard('set_interval');
    set_interval.registerRunListener(async (args, state) => {
        homey.app.log('[Actions] - Set interval');
        await homey.app.setIntervalTime(args.interval);
    });

    const manual_update = homey.flow.getActionCard('manual_update');
    manual_update.registerRunListener(async (args, state) => {
        homey.app.log('[Actions] - Manual update');
        await homey.app.updateData();
    });

    const set_should_locate = homey.flow.getActionCard('set_should_locate');
    set_should_locate.registerRunListener(async (args, state) => {
        homey.app.log('[Actions] - Set should locate');
        await homey.app.setShouldLocate(args.shouldlocate);
    });
};

export default init;