(() => {
    // 1. Save the original browser function
    const OriginalPeerConnection = window.RTCPeerConnection;
    if (!OriginalPeerConnection) return; // Browser doesn't support WebRTC

    // 2. Overwrite it with our wrapper
    window.RTCPeerConnection = function (config) {
        const pc = new OriginalPeerConnection(config);

        // 3. Listen for connection state changes
        const checkState = () => {
            const state = pc.connectionState || pc.iceConnectionState;
            if (state === 'connected') {
                window.postMessage({ type: "EXT_RTC_CONNECTED" }, "*");
            } else if (['disconnected', 'closed', 'failed'].includes(state)) {
                window.postMessage({ type: "EXT_RTC_DISCONNECTED" }, "*");
            }
        };

        pc.addEventListener('connectionstatechange', checkState);
        pc.addEventListener('iceconnectionstatechange', checkState);

        return pc;
    };

    // 4. Ensure "instanceof" checks still pass so we don't break Google Meet
    window.RTCPeerConnection.prototype = OriginalPeerConnection.prototype;
})();
