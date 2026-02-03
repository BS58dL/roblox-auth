// api/verify.js - 纯内存版（无依赖，最稳定）
const db = {
    "BS58-VIP-2024": { exp: 9999999999, maxDevices: 2, devices: [] },
    "TEST-001": { exp: 9999999999, maxDevices: 1, devices: [] },
    "免费测试": { exp: 9999999999, maxDevices: 5, devices: [] }
};

module.exports = async function handler(req, res) {
    // 跨域设置
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: '仅支持POST' });

    try {
        const { action, key, hwid } = req.body || {};
        
        if (!key || !hwid) {
            return res.json({ valid: false, msg: '缺少key或hwid参数' });
        }

        const keyData = db[key];
        
        // 卡密不存在
        if (!keyData) {
            return res.json({ valid: false, msg: '卡密不存在' });
        }

        // 检查过期（时间戳对比）
        const now = Math.floor(Date.now() / 1000);
        if (now > keyData.exp) {
            return res.json({ valid: false, msg: '卡密已过期' });
        }

        // 验证操作
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
                    msg: `已达到最大绑定数(${keyData.maxDevices}台)` 
                });
            }
        }
        
        // 绑定操作
        else if (action === 'bind') {
            // 已绑定
            if (keyData.devices.includes(hwid)) {
                return res.json({ 
                    success: true, 
                    msg: '设备已绑定',
                    deviceNum: keyData.devices.length 
                });
            }
            
            // 设备数已满
            if (keyData.devices.length >= keyData.maxDevices) {
                return res.json({ 
                    success: false, 
                    msg: `绑定失败，已达上限(${keyData.maxDevices}台)` 
                });
            }
            
            // 执行绑定
            keyData.devices.push(hwid);
            
            return res.json({ 
                success: true, 
                msg: '绑定成功', 
                deviceNum: keyData.devices.length,
                maxDevices: keyData.maxDevices
            });
        }
        
        // 解绑操作（可选）
        else if (action === 'unbind') {
            keyData.devices = keyData.devices.filter(d => d !== hwid);
            return res.json({ 
                success: true, 
                msg: '解绑成功',
                remaining: keyData.devices.length 
            });
        }
        
        // 查询操作（可选）
        else if (action === 'info') {
            return res.json({
                key: key,
                maxDevices: keyData.maxDevices,
                currentDevices: keyData.devices.length,
                devices: keyData.devices, // 返回所有设备ID（调试用）
                exp: keyData.exp
            });
        }
        
        return res.json({ error: '未知操作类型' });
        
    } catch (error) {
        console.error('服务器错误:', error);
        return res.status(500).json({ 
            error: '服务器内部错误', 
            msg: error.message 
        });
    }
};
