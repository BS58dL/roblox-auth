import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// 从环境变量读取卡密列表（不会泄露在代码里）
const VALID_KEYS = process.env.VALID_KEYS?.split(',') || [];

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const { action, key, hwid } = req.body || {};
        
        if (!key || !hwid) {
            return res.json({ valid: false, msg: '缺少参数' });
        }

        // 检查卡密是否在环境变量列表里
        if (!VALID_KEYS.includes(key)) {
            return res.json({ valid: false, msg: '卡密不存在' });
        }

        // 从Redis读取绑定数据（这里存的是绑定信息，不是卡密本身）
        let keyData = await redis.get(`auth:${key}`);
        
        // 如果是新卡密，初始化绑定数据
        if (!keyData) {
            // 解析卡密规则（比如 BS58-VIP-2024-2 表示2台设备）
            const maxDevices = parseInt(key.split('-').pop()) || 1;
            
            keyData = { 
                devices: [], 
                maxDevices: maxDevices,
                created: Date.now() 
            };
            await redis.set(`auth:${key}`, keyData);
        }

        if (action === 'verify') {
            if (keyData.devices.includes(hwid)) {
                return res.json({ valid: true, msg: '验证通过' });
            } else if (keyData.devices.length < keyData.maxDevices) {
                return res.json({ valid: false, canBind: true, msg: '未绑定' });
            } else {
                return res.json({ valid: false, msg: `已达上限(${keyData.maxDevices}台)` });
            }
        }
        
        if (action === 'bind') {
            if (keyData.devices.length >= keyData.maxDevices) {
                return res.json({ success: false, msg: '设备数已满' });
            }
            keyData.devices.push(hwid);
            await redis.set(`auth:${key}`, keyData);
            return res.json({ success: true, msg: '绑定成功', deviceNum: keyData.devices.length });
        }
        
        return res.json({ error: '未知操作' });
        
    } catch (error) {
        console.error('错误:', error);
        return res.status(500).json({ error: error.message });
    }
}
