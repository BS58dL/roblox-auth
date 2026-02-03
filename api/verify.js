// 使用CommonJS语法（兼容性好）
const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { action, key, hwid } = req.body;
        
        if (!key || !hwid) {
            return res.status(400).json({ valid: false, msg: '缺少参数' });
        }

        // 从Redis读取
        let keyData = await kv.get(`key:${key}`);
        
        // 初始化预设卡密
        if (!keyData) {
            const presetKeys = {
                "BS58-VIP-2024": { exp: 9999999999, maxDevices: 2 },
                "TEST-001": { exp: 9999999999, maxDevices: 1 },
                "永久卡密-ABC": { exp: 9999999999, maxDevices: 3 }
            };
            
            if (presetKeys[key]) {
                keyData = { ...presetKeys[key], devices: [] };
                await kv.set(`key:${key}`, keyData);
            } else {
                return res.json({ valid: false, msg: '卡密不存在' });
            }
        }

        // 检查过期
        if (Math.floor(Date.now() / 1000) > keyData.exp) {
            return res.json({ valid: false, msg: '卡密已过期' });
        }

        // 验证
        if (action === 'verify') {
            const isBound = keyData.devices.includes(hwid);
            
            if (isBound) {
                return res.json({ valid: true, msg: '验证通过', deviceNum: keyData.devices.length });
            } else if (keyData.devices.length < keyData.maxDevices) {
                return res.json({ valid: false, msg: '未绑定此设备', canBind: true });
            } else {
                return res.json({ valid: false, msg: `已达到最大绑定数(${keyData.maxDevices}台)` });
            }
        }
        
        // 绑定
        else if (action === 'bind') {
            if (keyData.devices.includes(hwid)) {
                return res.json({ success: true, msg: '设备已绑定' });
            }
            
            if (keyData.devices.length >= keyData.maxDevices) {
                return res.json({ success: false, msg: `已达上限(${keyData.maxDevices}台)` });
            }
            
            keyData.devices.push(hwid);
            await kv.set(`key:${key}`, keyData);
            
            return res.json({ success: true, msg: '绑定成功', deviceNum: keyData.devices.length });
        }
        
        return res.status(400).json({ error: '未知操作' });
        
    } catch (error) {
        console.error('服务器错误:', error);
        return res.status(500).json({ error: '服务器内部错误', details: error.message });
    }
};
