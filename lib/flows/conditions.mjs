const init = async function (homey) {
    const is_home = homey.flow.getConditionCard('is_home')
    is_home.registerRunListener( async (args, state) =>  {
       homey.app.log('[is_home]', state, {...args, device: 'LOG'});
       return await args.device.getCapabilityValue(`alarm_is_home`);
    });

    const is_charging = homey.flow.getConditionCard('is_charging')
    is_charging.registerRunListener( async (args, state) =>  {
       homey.app.log('[is_charging]', state, {...args, device: 'LOG'});
       return await args.device.getCapabilityValue(`alarm_is_charging`);
    });

    const is_in_range = homey.flow.getConditionCard('is_in_range');
    is_in_range.registerRunListener(async (args, state) => {
        homey.app.log('[is_in_range]', state, { ...args, device: 'LOG' });

        return args.device.checkLocation(null, { lat: args.latitude, lon: args.longitude }) <= args.radius;
    });
};

export default init;