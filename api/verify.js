// api/verify.js - 使用Vercel KV（正确版）
// 注意：必须用 import 语法，且确保环境变量已设置

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: '仅支持POST' });

    try {
        const { action, key, hwid } = req.body || {};
        
        if (!key || !hwid) {
            return res.json({ valid: false, msg: '缺少参数' });
        }

        // 从Redis读取，如果不存在返回null
        let keyData = await kv.get(`auth:${key}`);
        
        // 初始化新卡密
        if (!keyData) {
            const presetKeys = {
                "BS58-VIP-2024": { exp: 9999999999, maxDevices: 2 },
                "TEST-001": { exp: 9999999999, maxDevices: 1 },
                "永久卡密-ABC": { exp: 9999999999, maxDevices: 3 }
            };
            
            if (presetKeys[key]) {
                keyData = { ...presetKeys[key], devices: [] };
                await kv.set(`auth:${key}`, keyData);
            } else {
                return res.json({ valid: false, msg: '卡密不存在' });
            }
        }

        // 验证
        if (action === 'verify') {
            if (keyData.devices.includes(hwid)) {
                return res.json({ valid: true, msg: '验证通过', deviceNum: keyData.devices.length });
            } else if (keyData.devices.length < keyData.maxDevices) {
                return res.json({ valid: false, canBind: true, msg: '未绑定' });
            } else {
                return res.json({ valid: false, msg: `已达上限(${keyData.maxDevices}台)` });
            }
        }
        
        // 绑定
        if (action === 'bind') {
            if (keyData.devices.length >= keyData.maxDevices) {
                return res.json({ success: false, msg: '设备数已满' });
            }
            keyData.devices.push(hwid);
            await kv.set(`auth:${key}`, keyData);
            return res.json({ success: true, msg: '绑定成功', deviceNum: keyData.devices.length });
        }
        
        return res.json({ error: '未知操作' });
        
    } catch (error) {
        console.error('Redis错误:', error);
        return res.status(500).json({ error: '数据库错误', msg: error.message });
    }
}
