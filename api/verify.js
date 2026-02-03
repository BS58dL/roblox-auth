export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (req.method !== 'POST') return res.status(405).end();

    const { action, key, hwid } = req.body;
    
    // 内存数据库（重启后重置，适合演示）
    const db = {
        "BS58-VIP-2024": { exp: 9999999999, maxDevices: 2, devices: [] },
        "TEST-001": { exp: 9999999999, maxDevices: 1, devices: [] }
    };

    const keyData = db[key];
    if (!keyData) return res.json({ valid: false, msg: '卡密无效' });
    
    if (action === 'verify') {
        if (keyData.devices.includes(hwid)) {
            return res.json({ valid: true, msg: '验证通过' });
        } else if (keyData.devices.length < keyData.maxDevices) {
            return res.json({ valid: false, canBind: true, msg: '未绑定' });
        } else {
            return res.json({ valid: false, msg: '设备数已达上限' });
        }
    }
    
    if (action === 'bind') {
        if (keyData.devices.length >= keyData.maxDevices) {
            return res.json({ success: false, msg: '设备数已满' });
        }
        keyData.devices.push(hwid);
        return res.json({ success: true, msg: '绑定成功', deviceNum: keyData.devices.length });
    }
}
