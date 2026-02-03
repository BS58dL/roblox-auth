import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    // 允许跨域（Roblox需要）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { action, key, hwid } = req.body;
    
    if (!key || !hwid) {
        return res.status(400).json({ valid: false, msg: '缺少参数' });
    }

    // 从Redis读取卡密数据
    let keyData = await kv.get(`key:${key}`);
    
    // 如果卡密不存在，检查是否是预设卡密
    if (!keyData) {
        const presetKeys = {
            "BS58-VIP-2024": { exp: 9999999999, maxDevices: 2 },
            "TEST-001": { exp: 9999999999, maxDevices: 1 },
            "永久卡密-ABC": { exp: 9999999999, maxDevices: 3 }
        };
        
        if (presetKeys[key]) {
            keyData = {
                ...presetKeys[key],
                devices: []
            };
            // 保存到Redis
            await kv.set(`key:${key}`, keyData);
        } else {
            return res.json({ valid: false, msg: '卡密不存在' });
        }
    }

    // 检查是否过期
    if (Math.floor(Date.now() / 1000) > keyData.exp) {
        return res.json({ valid: false, msg: '卡密已过期' });
    }

    // 验证设备
    if (action === 'verify') {
        const isBound = keyData.devices.includes(hwid);
        
        if (isBound) {
            return res.json({ 
                valid: true, 
                msg: '验证通过',
                deviceNum: keyData.devices.length,
                maxDevices: keyData.maxDevices
            });
        } else if (keyData.devices.length < keyData.maxDevices) {
            return res.json({ 
                valid: false, 
                msg: '未绑定此设备', 
                canBind: true,
                currentDevices: keyData.devices.length,
                maxDevices: keyData.maxDevices
            });
        } else {
            return res.json({ 
                valid: false, 
                msg: `已达到最大绑定数(${keyData.maxDevices}台)，请解绑其他设备` 
            });
        }
    }
    
    // 绑定设备
    else if (action === 'bind') {
        if (keyData.devices.includes(hwid)) {
            return res.json({ success: true, msg: '设备已绑定' });
        }
        
        if (keyData.devices.length >= keyData.maxDevices) {
            return res.json({ 
                success: false, 
                msg: `绑定失败，已达上限(${keyData.maxDevices}台)` 
            });
        }
        
        keyData.devices.push(hwid);
        await kv.set(`key:${key}`, keyData);
        
        return res.json({ 
            success: true, 
            msg: '绑定成功', 
            deviceNum: keyData.devices.length,
            maxDevices: keyData.maxDevices
        });
    }
    
    // 解绑设备（可选）
    else if (action === 'unbind') {
        keyData.devices = keyData.devices.filter(d => d !== hwid);
        await kv.set(`key:${key}`, keyData);
        return res.json({ success: true, msg: '解绑成功', remaining: keyData.devices.length });
    }
    
    return res.status(400).json({ error: '未知操作' });
}
