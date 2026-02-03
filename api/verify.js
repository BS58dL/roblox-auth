import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

// 管理密码（自己设置一个复杂的）
const ADMIN_PASSWORD = 'BS58Admin888!';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const { action, key, hwid, adminKey, maxDevices = 2 } = req.body;

        // ========== 管理接口：添加卡密 ==========
        if (action === 'admin_add') {
            if (adminKey !== ADMIN_PASSWORD) {
                return res.json({ success: false, msg: '管理密码错误' });
            }
            
            if (!key) return res.json({ success: false, msg: '缺少卡密' });
            
            // 检查是否已存在
            const exists = await redis.get(`key:${key}`);
            if (exists) return res.json({ success: false, msg: '卡密已存在' });
            
            // 添加到Redis
            await redis.set(`key:${key}`, {
                devices: [],
                maxDevices: parseInt(maxDevices) || 2,
                created: Date.now()
            });
            
            return res.json({ 
                success: true, 
                msg: `卡密 ${key} 添加成功`,
                maxDevices: maxDevices 
            });
        }

        // ========== 管理接口：查看所有卡密 ==========
        if (action === 'admin_list') {
            if (adminKey !== ADMIN_PASSWORD) {
                return res.json({ success: false, msg: '管理密码错误' });
            }
            
            // 获取所有卡密（Upstash支持keys命令）
            const keys = await redis.keys('key:*');
            const list = [];
            
            for (const k of keys) {
                const data = await redis.get(k);
                list.push({
                    key: k.replace('key:', ''),
                    devices: data.devices.length,
                    maxDevices: data.maxDevices,
                    created: new Date(data.created).toLocaleString()
                });
            }
            
            return res.json({ success: true, data: list });
        }

        // ========== 管理接口：删除卡密 ==========
        if (action === 'admin_del') {
            if (adminKey !== ADMIN_PASSWORD) {
                return res.json({ success: false, msg: '管理密码错误' });
            }
            
            await redis.del(`key:${key}`);
            return res.json({ success: true, msg: `卡密 ${key} 已删除` });
        }

        // ========== 普通验证接口 ==========
        if (!key || !hwid) {
            return res.json({ valid: false, msg: '缺少参数' });
        }

        let keyData = await redis.get(`key:${key}`);
        
        // 如果没有这个卡密，返回不存在（不再从环境变量读取）
        if (!keyData) {
            return res.json({ valid: false, msg: '卡密不存在' });
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
            await redis.set(`key:${key}`, keyData);
            return res.json({ success: true, msg: '绑定成功' });
        }
        
        return res.json({ error: '未知操作' });
        
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
