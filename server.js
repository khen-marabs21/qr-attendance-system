const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

const db = new sqlite3.Database('./attendance.db', (err) => {
  if (err) console.error('Database connection error:', err);
  else console.log('Connected to SQLite database.');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    session_code TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_code TEXT NOT NULL,
    section TEXT NOT NULL,
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    timestamp DATETIME DEFAULT (datetime('now', '+8 hours')),
    UNIQUE(session_code, student_id)
  )`);
});

app.post('/api/create-session', async (req, res) => {
  const { subject } = req.body;
  if (!subject) return res.status(400).json({ error: 'Subject is required.' });

  const sessionCode = `${subject.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`;
  const host = req.get('host');
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const qrUrl = `${protocol}://${host}/scan.html?session=${sessionCode}`;

  try {
    const qrImage = await QRCode.toDataURL(qrUrl);
    db.run(
      `INSERT INTO sessions (subject, session_code) VALUES (?, ?)`,
      [subject, sessionCode],
      function (err) {
        if (err) return res.status(500).json({ error: 'Failed to create session.' });
        res.json({ success: true, sessionCode, qrImage, qrUrl });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR Code.' });
  }
});

app.post('/api/submit-attendance', (req, res) => {
  const { sessionCode, section, studentId } = req.body;
  let { studentName } = req.body;

  if (!sessionCode || !section || !studentId || !studentName) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const cleanName = studentName.trim().toUpperCase();
  let formattedName = cleanName;

  if (cleanName.includes(',')) {
    formattedName = cleanName;
  } else {
    const parts = cleanName.split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) {
      const lastName = parts[parts.length - 1];
      const firstNames = parts.slice(0, parts.length - 1).join(' ');
      formattedName = `${lastName}, ${firstNames}`;
    }
  }

  const formattedId = studentId.trim().toUpperCase();
  const formattedSection = section.trim().toUpperCase();

  db.run(
    `INSERT INTO attendance (session_code, section, student_id, student_name, timestamp) VALUES (?, ?, ?, ?, datetime('now', '+8 hours'))`,
    [sessionCode, formattedSection, formattedId, formattedName],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'You have already checked in for this session.' });
        }
        return res.status(500).json({ error: 'Database recording error.' });
      }
      res.json({ success: true, message: 'Attendance recorded successfully!' });
    }
  );
});

app.get('/api/attendance-logs/:sessionCode', (req, res) => {
  const { sessionCode } = req.params;
  db.all(
    `SELECT student_id, student_name, section, timestamp FROM attendance WHERE session_code = ? ORDER BY timestamp DESC`,
    [sessionCode],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to retrieve logs.' });
      res.json({ logs: rows });
    }
  );
});

app.get('/api/export-csv/:sessionCode', (req, res) => {
  const { sessionCode } = req.params;
  db.all(
    `SELECT student_id, student_name, section, timestamp FROM attendance WHERE session_code = ? ORDER BY timestamp DESC`,
    [sessionCode],
    (err, rows) => {
      if (err) return res.status(500).send('Error generating export.');
      
      let csv = 'Student ID,Student Name,Section,Timestamp\n';
      rows.forEach(r => {
        csv += `"${r.student_id}","${r.student_name}","${r.section}","${r.timestamp}"\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=attendance-${sessionCode}.csv`);
      res.status(200).send(csv);
    }
  );
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});