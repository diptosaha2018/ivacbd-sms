const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// মিডলওয়্যার
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ডাটাবেস ফাইল পাথ
const DB_PATH = path.join(__dirname, 'sms_database.json');
const DEVICES_PATH = path.join(__dirname, 'devices.json');

// ডাটাবেস ইনিশিয়ালাইজ
let smsDatabase = [];
let devices = {};

// ডাটাবেস লোড করা
function loadDatabase() {
    try {
        if (fs.existsSync(DB_PATH)) {
            smsDatabase = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        }
        if (fs.existsSync(DEVICES_PATH)) {
            devices = JSON.parse(fs.readFileSync(DEVICES_PATH, 'utf8'));
        }
        console.log(`✅ Loaded ${smsDatabase.length} SMS records`);
        console.log(`✅ Loaded ${Object.keys(devices).length} devices`);
    } catch (error) {
        console.error('Error loading database:', error);
    }
}

// ডাটাবেস সেভ করা
function saveDatabase() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(smsDatabase, null, 2));
        fs.writeFileSync(DEVICES_PATH, JSON.stringify(devices, null, 2));
    } catch (error) {
        console.error('Error saving database:', error);
    }
}

// OTP এক্সট্র্যাক্ট ফাংশন
function extractOtp(content) {
    // সাধারণ OTP প্যাটার্ন
    const patterns = [
        /\b\d{4,8}\b/g,  // 4-8 ডিজিটের সংখ্যা
        /OTP[:\s]*(\d{4,8})/i,
        /code[:\s]*(\d{4,8})/i,
        /verification[:\s]*(\d{4,8})/i,
        /পিন[:\s]*(\d{4,8})/i,
        /কোড[:\s]*(\d{4,8})/i
    ];
    
    for (let pattern of patterns) {
        let match = content.match(pattern);
        if (match) {
            let otp = match[0].match(/\d+/);
            if (otp) return otp[0];
        }
    }
    
    // টেক্সট টু নাম্বার কনভার্ট (Five-Eight-Five-Eight-Eight-Three)
    const wordToNum = {
        'Zero': '0', 'One': '1', 'Two': '2', 'Three': '3', 'Four': '4',
        'Five': '5', 'Six': '6', 'Seven': '7', 'Eight': '8', 'Nine': '9'
    };
    
    let wordPattern = /(?:Five|Six|Seven|Eight|Nine|Zero|One|Two|Three|Four)/gi;
    let matches = content.match(wordPattern);
    if (matches && matches.length >= 4) {
        let otp = '';
        for (let match of matches) {
            if (wordToNum[match]) {
                otp += wordToNum[match];
            }
        }
        if (otp.length >= 4) return otp;
    }
    
    return null;
}

// ============= API ENDPOINTS =============

// 1. SMS গ্রহণ API (মোবাইল থেকে কল হবে)
app.post('/api/sms/receive', (req, res) => {
    const { 
        deviceId,      // মোবাইলের ইউনিক আইডি
        deviceName,    // মোবাইলের নাম
        sim,           // SIM 1 or SIM 2
        sender,        // সেন্ডার নাম
        content,       // SMS কন্টেন্ট
        timestamp      // টাইমস্ট্যাম্প
    } = req.body;
    
    // ভ্যালিডেশন
    if (!deviceId || !sender || !content) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing required fields' 
        });
    }
    
    // ডিভাইস রেজিস্টার করুন যদি নতুন হয়
    if (!devices[deviceId]) {
        devices[deviceId] = {
            id: deviceId,
            name: deviceName || `Device ${Object.keys(devices).length + 1}`,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            totalSms: 0
        };
    } else {
        devices[deviceId].lastSeen = new Date().toISOString();
        devices[deviceId].name = deviceName || devices[deviceId].name;
    }
    
    // OTP এক্সট্র্যাক্ট করুন
    const otp = extractOtp(content);
    
    // SMS অবজেক্ট তৈরি
    const sms = {
        id: Date.now() + Math.random(),
        deviceId: deviceId,
        deviceName: devices[deviceId].name,
        sim: sim || 'Unknown',
        sender: sender,
        content: content,
        otp: otp,
        timestamp: timestamp || new Date().toISOString(),
        receivedAt: new Date().toISOString()
    };
    
    // ডাটাবেসে যোগ করুন
    smsDatabase.unshift(sms);
    
    // সর্বশেষ ১০,০০০টি SMS রাখুন
    if (smsDatabase.length > 10000) {
        smsDatabase = smsDatabase.slice(0, 10000);
    }
    
    // ডিভাইসের কাউন্ট আপডেট
    devices[deviceId].totalSms++;
    
    // ডাটাবেস সেভ
    saveDatabase();
    
    console.log(`📨 New SMS from ${devices[deviceId].name}: ${content.substring(0, 50)}...`);
    if (otp) {
        console.log(`🔑 OTP Detected: ${otp}`);
    }
    
    res.json({ 
        success: true, 
        smsId: sms.id,
        otp: otp,
        message: 'SMS received successfully'
    });
});

// 2. সব SMS পাওয়ার API
app.get('/api/sms/list', (req, res) => {
    const { limit = 100, deviceId, otpOnly } = req.query;
    
    let filteredSms = [...smsDatabase];
    
    if (deviceId) {
        filteredSms = filteredSms.filter(sms => sms.deviceId === deviceId);
    }
    
    if (otpOnly === 'true') {
        filteredSms = filteredSms.filter(sms => sms.otp);
    }
    
    filteredSms = filteredSms.slice(0, parseInt(limit));
    
    res.json({
        success: true,
        total: smsDatabase.length,
        filtered: filteredSms.length,
        sms: filteredSms
    });
});

// 3. ডিভাইস লিস্ট পাওয়ার API
app.get('/api/devices/list', (req, res) => {
    const deviceList = Object.values(devices).map(device => ({
        ...device,
        lastSms: smsDatabase.find(sms => sms.deviceId === device.id)?.timestamp || null
    }));
    
    res.json({
        success: true,
        total: deviceList.length,
        devices: deviceList
    });
});

// 4. স্ট্যাটিসটিক্স API
app.get('/api/stats', (req, res) => {
    const totalSms = smsDatabase.length;
    const totalOtp = smsDatabase.filter(sms => sms.otp).length;
    const last24h = smsDatabase.filter(sms => {
        const smsTime = new Date(sms.timestamp);
        const now = new Date();
        const diff = now - smsTime;
        return diff <= 24 * 60 * 60 * 1000;
    }).length;
    
    res.json({
        success: true,
        stats: {
            totalSms,
            totalOtp,
            last24h,
            deviceCount: Object.keys(devices).length
        },
        deviceStats: devices
    });
});

// 5. SMS ডিলিট API
app.delete('/api/sms/delete/:id', (req, res) => {
    const { id } = req.params;
    const index = smsDatabase.findIndex(sms => sms.id == id);
    
    if (index !== -1) {
        smsDatabase.splice(index, 1);
        saveDatabase();
        res.json({ success: true, message: 'SMS deleted' });
    } else {
        res.status(404).json({ success: false, error: 'SMS not found' });
    }
});

// 6. সব SMS ক্লিয়ার API
app.delete('/api/sms/clear', (req, res) => {
    smsDatabase = [];
    saveDatabase();
    res.json({ success: true, message: 'All SMS cleared' });
});

// 7. ডিভাইস রিমুভ API
app.delete('/api/devices/remove/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    
    if (devices[deviceId]) {
        delete devices[deviceId];
        // ডিভাইসের সব SMS মুছুন
        smsDatabase = smsDatabase.filter(sms => sms.deviceId !== deviceId);
        saveDatabase();
        res.json({ success: true, message: 'Device removed' });
    } else {
        res.status(404).json({ success: false, error: 'Device not found' });
    }
});

// সার্ভার চালু
app.listen(PORT, () => {
    loadDatabase();
    console.log(`
╔══════════════════════════════════════════════════════════╗
║     🚀 SMS Central Server Started Successfully!         ║
╠══════════════════════════════════════════════════════════╣
║  Server running on: http://localhost:${PORT}              ║
║  Dashboard URL: http://localhost:${PORT}                  ║
╠══════════════════════════════════════════════════════════╣
║  📱 API Endpoints:                                       ║
║  POST   /api/sms/receive    - Receive SMS from mobile   ║
║  GET    /api/sms/list       - Get all SMS               ║
║  GET    /api/devices/list   - Get all devices           ║
║  GET    /api/stats          - Get statistics            ║
╠══════════════════════════════════════════════════════════╣
║  💡 Use this IP for mobile apps:                        ║
║  Find your IP: Run 'ipconfig' in cmd                    ║
╚══════════════════════════════════════════════════════════╝
    `);
});