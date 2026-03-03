require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Ensure directories exist ----------
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

// Data files
const propertiesFile = path.join(dataDir, 'properties.json');
if (!fs.existsSync(propertiesFile)) fs.writeFileSync(propertiesFile, '[]');

const adminFile = path.join(dataDir, 'admin.json');
if (!fs.existsSync(adminFile)) {
  // Create from .env on first run
  const saltRounds = 10;
  const plainPassword = process.env.ADMIN_PASS;
  const securityQuestion = process.env.ADMIN_SECURITY_QUESTION || 'What is your favorite color?';
  const securityAnswer = process.env.ADMIN_SECURITY_ANSWER;
  if (!plainPassword || !securityAnswer) {
    console.error('ADMIN_PASS and ADMIN_SECURITY_ANSWER must be set in .env');
    process.exit(1);
  }
  const passwordHash = bcrypt.hashSync(plainPassword, saltRounds);
  const answerHash = bcrypt.hashSync(securityAnswer.toLowerCase().trim(), saltRounds);
  const adminData = {
    username: process.env.ADMIN_USER || 'admin',
    password: passwordHash,
    securityQuestion: securityQuestion,
    securityAnswer: answerHash
  };
  fs.writeFileSync(adminFile, JSON.stringify(adminData, null, 2));
}

const inquiriesFile = path.join(dataDir, 'inquiries.json');
if (!fs.existsSync(inquiriesFile)) fs.writeFileSync(inquiriesFile, '[]');

// ---------- Middleware ----------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// ---------- Helper functions ----------
function readProperties() {
  return JSON.parse(fs.readFileSync(propertiesFile, 'utf8'));
}
function writeProperties(data) {
  fs.writeFileSync(propertiesFile, JSON.stringify(data, null, 2));
}

function readAdmin() {
  return JSON.parse(fs.readFileSync(adminFile, 'utf8'));
}
function writeAdmin(data) {
  fs.writeFileSync(adminFile, JSON.stringify(data, null, 2));
}

function readInquiries() {
  return JSON.parse(fs.readFileSync(inquiriesFile, 'utf8'));
}
function writeInquiries(data) {
  fs.writeFileSync(inquiriesFile, JSON.stringify(data, null, 2));
}

// ---------- Multer config ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ---------- PUBLIC API ----------
// GET /api/properties?page=1&limit=6&location=...&type=...&minPrice=...&maxPrice=...&bedrooms=...&sort=...
app.get('/api/properties', (req, res) => {
  let properties = readProperties();

  // --- Filtering ---
  const { location, type, minPrice, maxPrice, bedrooms, sort } = req.query;

  if (location && location !== 'Any') {
    properties = properties.filter(p => p.location.toLowerCase().includes(location.toLowerCase()));
  }

  if (type && type !== 'Any') {
    properties = properties.filter(p => p.property_type === type);
  }

  if (minPrice) {
    const min = parseFloat(minPrice.replace(/,/g, ''));
    if (!isNaN(min)) {
      properties = properties.filter(p => parseFloat(p.price.replace(/,/g, '')) >= min);
    }
  }

  if (maxPrice) {
    const max = parseFloat(maxPrice.replace(/,/g, ''));
    if (!isNaN(max)) {
      properties = properties.filter(p => parseFloat(p.price.replace(/,/g, '')) <= max);
    }
  }

  if (bedrooms && bedrooms !== 'Any') {
    const beds = parseInt(bedrooms);
    if (!isNaN(beds)) {
      if (bedrooms === '4+') {
        properties = properties.filter(p => p.bedrooms >= 4);
      } else {
        properties = properties.filter(p => p.bedrooms === beds);
      }
    }
  }

  // --- Sorting ---
  if (sort) {
    switch (sort) {
      case 'price_asc':
        properties.sort((a, b) => parseFloat(a.price.replace(/,/g, '')) - parseFloat(b.price.replace(/,/g, '')));
        break;
      case 'price_desc':
        properties.sort((a, b) => parseFloat(b.price.replace(/,/g, '')) - parseFloat(a.price.replace(/,/g, '')));
        break;
      case 'newest':
      default:
        properties.sort((a, b) => new Date(b.date_added) - new Date(a.date_added));
        break;
    }
  } else {
    properties.sort((a, b) => new Date(b.date_added) - new Date(a.date_added));
  }

  // --- Pagination ---
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 6;
  const start = (page - 1) * limit;
  const end = start + limit;
  const paginated = properties.slice(start, end);

  res.json({
    total: properties.length,
    page: page,
    limit: limit,
    totalPages: Math.ceil(properties.length / limit),
    data: paginated
  });
});

app.get('/api/properties/:id', (req, res) => {
  const properties = readProperties();
  const property = properties.find(p => p.id === req.params.id);
  if (property) res.json(property);
  else res.status(404).json({ error: 'Not found' });
});

// ---------- CONTACT FORM ----------
app.post('/api/contact', (req, res) => {
  const { name, email, phone, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email and message are required.' });
  }

  const inquiries = readInquiries();
  const newInquiry = {
    id: Date.now().toString(),
    name,
    email,
    phone: phone || '',
    subject: subject || 'General Inquiry',
    message,
    date: new Date().toISOString(),
    read: false
  };
  inquiries.push(newInquiry);
  writeInquiries(inquiries);
  res.json({ success: true, message: 'Your message has been sent. We will contact you soon.' });
});

// ---------- ADMIN LOGIN (unprotected) ----------
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = readAdmin();
  if (username === admin.username && bcrypt.compareSync(password, admin.password)) {
    req.session.loggedIn = true;
    res.redirect('/admin/dashboard');
  } else {
    res.redirect('/admin/login?error=invalid');
  }
});

// ---------- FORGOT / RESET PASSWORD ----------
app.get('/api/admin/question', (req, res) => {
  const admin = readAdmin();
  res.json({ question: admin.securityQuestion });
});

app.get('/admin/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'forgot-password.html'));
});

app.post('/admin/forgot-password', (req, res) => {
  const { answer } = req.body;
  const admin = readAdmin();
  if (bcrypt.compareSync(answer.toLowerCase().trim(), admin.securityAnswer)) {
    req.session.resetAuthorized = true;
    res.redirect('/admin/reset-password');
  } else {
    res.redirect('/admin/forgot-password?error=incorrect');
  }
});

app.get('/admin/reset-password', (req, res) => {
  if (!req.session.resetAuthorized) return res.redirect('/admin/forgot-password');
  res.sendFile(path.join(__dirname, 'admin', 'reset-password.html'));
});

app.post('/admin/reset-password', (req, res) => {
  if (!req.session.resetAuthorized) return res.redirect('/admin/forgot-password');
  const { new_password, confirm_password } = req.body;
  if (new_password !== confirm_password) {
    return res.redirect('/admin/reset-password?error=mismatch');
  }
  const saltRounds = 10;
  const newHash = bcrypt.hashSync(new_password, saltRounds);
  const admin = readAdmin();
  admin.password = newHash;
  writeAdmin(admin);
  req.session.resetAuthorized = false;
  res.redirect('/admin/login?success=reset');
});

// ---------- LOGOUT ----------
app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// ---------- PROTECT ALL ADMIN ROUTES BELOW ----------
app.use('/admin', (req, res, next) => {
  // Allow public access to login, forgot, reset (without session)
  if (req.path === '/login' || req.path === '/forgot-password' || req.path === '/reset-password') {
    return next();
  }
  if (req.session.loggedIn) next();
  else res.redirect('/admin/login');
});

// Serve admin HTML pages
app.get('/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});
app.get('/admin/add-property', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'add-property.html'));
});
app.get('/admin/edit-property', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'edit-property.html'));
});
app.get('/admin/change-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'change-password.html'));
});
app.get('/admin/security-settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'security-settings.html'));
});
app.get('/admin/inquiries', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'inquiries.html'));
});

// ---------- ADMIN CRUD: PROPERTIES ----------
app.post('/admin/properties', upload.fields([
  { name: 'main_image', maxCount: 1 },
  { name: 'thumbnails', maxCount: 10 }
]), (req, res) => {
  const properties = readProperties();
  const newId = 'prop_' + Date.now();
  const newProperty = {
    id: newId,
    title: req.body.title || '',
    location: req.body.location || '',
    price: req.body.price || '',
    price_small: req.body.price_small || '',
    bedrooms: req.body.bedrooms ? parseFloat(req.body.bedrooms) : 0,
    bathrooms: req.body.bathrooms ? parseFloat(req.body.bathrooms) : 0,
    // NEW FIELDS
    living_rooms: req.body.living_rooms ? parseInt(req.body.living_rooms) : 1,
    is_studio: req.body.is_studio === 'on',
    area: req.body.area || '',
    parking: req.body.parking ? parseInt(req.body.parking) : 0,
    description: req.body.description || '',
    features: req.body.features ? req.body.features.split(',').map(f => f.trim()) : [],
    property_type: req.body.property_type || 'House',
    status: req.body.status || 'For Sale',
    agent_id: req.body.agent_id || '',
    featured: req.body.featured === 'on',
    date_added: new Date().toISOString().split('T')[0],
    main_image: req.files['main_image'] ? '/uploads/' + req.files['main_image'][0].filename : '',
    thumbnails: req.files['thumbnails'] ? req.files['thumbnails'].map(f => '/uploads/' + f.filename) : []
  };
  properties.push(newProperty);
  writeProperties(properties);
  res.redirect('/admin/dashboard');
});

app.post('/admin/properties/:id', upload.fields([
  { name: 'main_image', maxCount: 1 },
  { name: 'thumbnails', maxCount: 10 }
]), (req, res) => {
  const properties = readProperties();
  const index = properties.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).send('Property not found');

  const existing = properties[index];
  const updated = {
    ...existing,
    title: req.body.title || existing.title,
    location: req.body.location || existing.location,
    price: req.body.price || existing.price,
    price_small: req.body.price_small || existing.price_small,
    bedrooms: req.body.bedrooms ? parseFloat(req.body.bedrooms) : existing.bedrooms,
    bathrooms: req.body.bathrooms ? parseFloat(req.body.bathrooms) : existing.bathrooms,
    // NEW FIELDS
    living_rooms: req.body.living_rooms ? parseInt(req.body.living_rooms) : existing.living_rooms,
    is_studio: req.body.is_studio === 'on',
    area: req.body.area || existing.area,
    parking: req.body.parking ? parseInt(req.body.parking) : existing.parking,
    description: req.body.description || existing.description,
    features: req.body.features ? req.body.features.split(',').map(f => f.trim()) : existing.features,
    property_type: req.body.property_type || existing.property_type,
    status: req.body.status || existing.status,
    agent_id: req.body.agent_id || existing.agent_id,
    featured: req.body.featured === 'on'
  };

  if (req.files['main_image']) {
    updated.main_image = '/uploads/' + req.files['main_image'][0].filename;
  }
  if (req.files['thumbnails']) {
    updated.thumbnails = req.files['thumbnails'].map(f => '/uploads/' + f.filename);
  }

  properties[index] = updated;
  writeProperties(properties);
  res.redirect('/admin/dashboard');
});

app.delete('/admin/properties/:id', (req, res) => {
  let properties = readProperties();
  properties = properties.filter(p => p.id !== req.params.id);
  writeProperties(properties);
  res.json({ success: true });
});

// ---------- ADMIN: DELETE PROPERTY IMAGE ----------
app.delete('/admin/properties/:id/images', (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: 'Unauthorized' });

  const { imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'Image URL required' });

  const properties = readProperties();
  const index = properties.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Property not found' });

  const property = properties[index];
  let deleted = false;

  // Check if it's the main image
  if (property.main_image === imageUrl) {
    property.main_image = '';
    deleted = true;
  } else {
    // Check thumbnails
    const thumbIndex = (property.thumbnails || []).indexOf(imageUrl);
    if (thumbIndex !== -1) {
      property.thumbnails.splice(thumbIndex, 1);
      deleted = true;
    }
  }

  if (!deleted) {
    return res.status(404).json({ error: 'Image not found in property' });
  }

  // Delete the actual file from uploads folder
  const filePath = path.join(__dirname, imageUrl); // imageUrl starts with /uploads/
  fs.unlink(filePath, (err) => {
    if (err) console.error('Failed to delete image file:', err);
    // Continue even if file deletion fails – we still update the record
  });

  writeProperties(properties);
  res.json({ success: true });
});

// ---------- ADMIN: CHANGE PASSWORD ----------
app.post('/admin/change-password', (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  if (new_password !== confirm_password) {
    return res.redirect('/admin/change-password?error=mismatch');
  }
  const admin = readAdmin();
  if (!bcrypt.compareSync(current_password, admin.password)) {
    return res.redirect('/admin/change-password?error=incorrect');
  }
  const saltRounds = 10;
  const newHash = bcrypt.hashSync(new_password, saltRounds);
  admin.password = newHash;
  writeAdmin(admin);
  res.redirect('/admin/change-password?success=1');
});

// ---------- ADMIN: SECURITY SETTINGS ----------
app.post('/admin/security-settings', (req, res) => {
  const { current_password, security_question, security_answer } = req.body;
  const admin = readAdmin();

  if (!bcrypt.compareSync(current_password, admin.password)) {
    return res.redirect('/admin/security-settings?error=incorrect');
  }

  if (security_question) admin.securityQuestion = security_question;
  if (security_answer) {
    const saltRounds = 10;
    admin.securityAnswer = bcrypt.hashSync(security_answer.toLowerCase().trim(), saltRounds);
  }

  writeAdmin(admin);
  res.redirect('/admin/security-settings?success=1');
});

// ---------- ADMIN: INQUIRIES API ----------
app.get('/api/inquiries', (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: 'Unauthorized' });
  const inquiries = readInquiries();
  inquiries.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(inquiries);
});

app.patch('/api/inquiries/:id', (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: 'Unauthorized' });
  const { read } = req.body;
  const inquiries = readInquiries();
  const index = inquiries.findIndex(i => i.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  inquiries[index].read = read;
  writeInquiries(inquiries);
  res.json({ success: true });
});

app.delete('/api/inquiries/:id', (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: 'Unauthorized' });
  let inquiries = readInquiries();
  inquiries = inquiries.filter(i => i.id !== req.params.id);
  writeInquiries(inquiries);
  res.json({ success: true });
});

// ---------- Agents data file ----------
const agentsFile = path.join(dataDir, 'agents.json');
if (!fs.existsSync(agentsFile)) fs.writeFileSync(agentsFile, '[]');

function readAgents() {
  return JSON.parse(fs.readFileSync(agentsFile, 'utf8'));
}
function writeAgents(data) {
  fs.writeFileSync(agentsFile, JSON.stringify(data, null, 2));
}

// ---------- Agents API (public) ----------
app.get('/api/agents', (req, res) => {
  const agents = readAgents();
  res.json(agents);
});

app.get('/api/agents/:id', (req, res) => {
  const agents = readAgents();
  const agent = agents.find(a => a.id === req.params.id);
  if (agent) res.json(agent);
  else res.status(404).json({ error: 'Not found' });
});

// ---------- Admin: Agents CRUD (protected) ----------
// Serve admin agent pages
app.get('/admin/agents', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'agents.html'));
});
app.get('/admin/add-agent', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'add-agent.html'));
});
app.get('/admin/edit-agent', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'edit-agent.html'));
});

// Create new agent
app.post('/admin/agents', upload.single('image'), (req, res) => {
  const agents = readAgents();
  const newId = 'agent_' + Date.now();
  const newAgent = {
    id: newId,
    name: req.body.name || '',
    role: req.body.role || '',
    experience: req.body.experience || '',
    phone: req.body.phone || '',
    email: req.body.email || '',
    whatsapp: req.body.whatsapp || '',
    specialties: req.body.specialties ? req.body.specialties.split(',').map(s => s.trim()) : [],
    image: req.file ? '/uploads/' + req.file.filename : ''
  };
  agents.push(newAgent);
  writeAgents(agents);
  res.redirect('/admin/agents');
});

// Update agent
app.post('/admin/agents/:id', upload.single('image'), (req, res) => {
  const agents = readAgents();
  const index = agents.findIndex(a => a.id === req.params.id);
  if (index === -1) return res.status(404).send('Agent not found');

  const existing = agents[index];
  const updated = {
    ...existing,
    name: req.body.name || existing.name,
    role: req.body.role || existing.role,
    experience: req.body.experience || existing.experience,
    phone: req.body.phone || existing.phone,
    email: req.body.email || existing.email,
    whatsapp: req.body.whatsapp || existing.whatsapp,
    specialties: req.body.specialties ? req.body.specialties.split(',').map(s => s.trim()) : existing.specialties
  };
  if (req.file) {
    updated.image = '/uploads/' + req.file.filename;
  }
  agents[index] = updated;
  writeAgents(agents);
  res.redirect('/admin/agents');
});

// Delete agent
app.delete('/admin/agents/:id', (req, res) => {
  let agents = readAgents();
  agents = agents.filter(a => a.id !== req.params.id);
  writeAgents(agents);
  res.json({ success: true });
});

// ---------- Materials data file ----------
const materialsFile = path.join(dataDir, 'materials.json');
if (!fs.existsSync(materialsFile)) fs.writeFileSync(materialsFile, '[]');

function readMaterials() {
  return JSON.parse(fs.readFileSync(materialsFile, 'utf8'));
}
function writeMaterials(data) {
  fs.writeFileSync(materialsFile, JSON.stringify(data, null, 2));
}

// ---------- Materials API (public) ----------
app.get('/api/materials', (req, res) => {
  const materials = readMaterials();
  // Optional pagination can be added later
  res.json(materials);
});

app.get('/api/materials/:id', (req, res) => {
  const materials = readMaterials();
  const material = materials.find(m => m.id === req.params.id);
  if (material) res.json(material);
  else res.status(404).json({ error: 'Not found' });
});

// ---------- Admin: Materials CRUD (protected) ----------
// Serve admin material pages
app.get('/admin/materials', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'materials.html'));
});
app.get('/admin/add-material', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'add-material.html'));
});
app.get('/admin/edit-material', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'edit-material.html'));
});

// Create new material
app.post('/admin/materials', upload.single('image'), (req, res) => {
  const materials = readMaterials();
  const newId = 'mat_' + Date.now();
  const newMaterial = {
    id: newId,
    name: req.body.name || '',
    category: req.body.category || '',
    description: req.body.description || '',
    price: req.body.price || '',
    price_label: req.body.price_label || '',
    reference: req.body.reference || '',
    image: req.file ? '/uploads/' + req.file.filename : ''
  };
  materials.push(newMaterial);
  writeMaterials(materials);
  res.redirect('/admin/materials');
});

// Update material
app.post('/admin/materials/:id', upload.single('image'), (req, res) => {
  const materials = readMaterials();
  const index = materials.findIndex(m => m.id === req.params.id);
  if (index === -1) return res.status(404).send('Material not found');

  const existing = materials[index];
  const updated = {
    ...existing,
    name: req.body.name || existing.name,
    category: req.body.category || existing.category,
    description: req.body.description || existing.description,
    price: req.body.price || existing.price,
    price_label: req.body.price_label || existing.price_label,
    reference: req.body.reference || existing.reference
  };
  if (req.file) {
    updated.image = '/uploads/' + req.file.filename;
  }
  materials[index] = updated;
  writeMaterials(materials);
  res.redirect('/admin/materials');
});

// Delete material
app.delete('/admin/materials/:id', (req, res) => {
  let materials = readMaterials();
  materials = materials.filter(m => m.id !== req.params.id);
  writeMaterials(materials);
  res.json({ success: true });
});

// ---------- START SERVER ----------
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Admin login: http://localhost:${PORT}/admin/login`);
});