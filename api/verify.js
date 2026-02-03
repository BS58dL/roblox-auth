import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

// 管理密码（硬编码，不再依赖环境变量）
const ADMIN_PASSWORD = 'BS58Admin888!';

// 默认卡密（首次启动时自动创建，防止 locked out）
const DEFAULT_KEYS = {
    "BS58-VIP-2024": { maxDevices: 2 },
    "TEST-001": { maxDevices: 1 }
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const { action, key, hwid, adminKey, maxDevices = 2 } = req.body || {};

        // ========== 初始化默认卡密（仅首次）==========
        if (action === 'init_defaults') {
            for (const [k, v] of Object.entries(DEFAULT_KEYS)) {
                const exists = await redis.get(`key:${k}`);
                if (!exists) {
                    await redis.set(`key:${k}`, {
                        devices: [],
                        maxDevices: v.maxDevices,
                        created: Date.now()
                    });
                }
            }
            return res.json({ success: true, msg: '默认卡密已初始化' });
        }

        // ========== 管理接口：添加卡密 ==========
        if (action === 'admin_add') {
            if (adminKey !== ADMIN_PASSWORD) {
                return res.json({ success: false, msg: '管理密码错误' });
            }
            
            if (!key) return res.json({ success: false, msg: '缺少卡密' });
            
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
            
            const keys = await redis.keys('key:*');
            const list = [];
            
            for (const k of keys) {
                const data = await redis.get(k);
                if (data) {
                    list.push({
                        key: k.replace('key:', ''),
                        boundDevices: data.devices.length,
                        maxDevices: data.maxDevices,
                        created: new Date(data.created).toLocaleString()
                    });
                }
            }
            
            return res.json({ success: true, count: list.length, data: list });
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
        
        // 如果没有这个卡密
        if (!keyData) {
            return res.json({ valid: false, msg: '卡密不存在' });
        }

        if (action === 'verify') {
            if (keyData.devices.includes(hwid)) {
                return res.json({ 
                    valid: true, 
                    msg: '验证通过',
                    deviceNum: keyData.devices.length 
                });
            } else if (keyData.devices.length < keyData.maxDevices) {
                return res.json({ 
                    valid: false, 
                    canBind: true, 
                    msg: '未绑定此设备',
                    currentDevices: keyData.devices.length,
                    maxDevices: keyData.maxDevices
                });
            } else {
                return res.json({ 
                    valid: false, 
                    msg: `已达到最大绑定数(${keyData.maxDevices}台)` 
                });
            }
        }
        
        if (action === 'bind') {
            if (keyData.devices.includes(hwid)) {
                return res.json({ success: true, msg: '设备已绑定' });
            }
            
            if (keyData.devices.length >= keyData.maxDevices) {
                return res.json({ success: false, msg: '设备数已满' });
            }
            
            keyData.devices.push(hwid);
            await redis.set(`key:${key}`, keyData);
            
            return res.json({ 
                success: true, 
                msg: '绑定成功', 
                deviceNum: keyData.devices.length 
            });
        }
        
        return res.json({ error: '未知操作' });
        
    } catch (error) {
        console.error('服务器错误:', error);
        return res.status(500).json({ 
            error: '服务器错误', 
            msg: error.message 
        });
    }
}
