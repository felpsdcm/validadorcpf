require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');

const app = express();

// Configurações do Express
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Configurações do Mongoose
mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 300000); // 5 minutos

// Modelo do CPF
const cpfSchema = new mongoose.Schema({
  cpf: { 
    type: String, 
    required: true, 
    unique: true,
    validate: {
      validator: function(v) {
        return /^\d{11}$/.test(v);
      },
      message: props => `${props.value} não é um CPF válido (deve ter 11 dígitos)`
    }
  },
  isValid: { 
    type: Boolean, 
    required: true,
    set: function(v) {
      // Converte objeto {valido: true} para booleano simples
      return typeof v === 'object' ? v.valido : v;
    }
  },
  verificationDate: { type: Date, default: Date.now }
}, {
  bufferTimeoutMS: 300000 // 5 minutos
});

const CPF = mongoose.model('CPF', cpfSchema);

// Conexão com MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 300000, // 5 minutos
  socketTimeoutMS: 300000,         // 5 minutos
  connectTimeoutMS: 300000,        // 5 minutos
  maxPoolSize: 10,
  retryWrites: true,
  w: 'majority'
})
.then(() => console.log('✅ Conectado ao MongoDB com sucesso!'))
.catch(err => {
  console.error('❌ Erro na conexão com MongoDB:', err);
  process.exit(1);
});

// Middleware para verificar conexão
app.use((req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).render('index', {
      result: null,
      error: '⚠️ Serviço temporariamente indisponível. Banco de dados não conectado.'
    });
  }
  next();
});

// Rotas
app.get('/', (req, res) => {
  res.render('index', { result: null, error: null });
});

app.post('/verificar-cpf', async (req, res) => {
  try {
    const { cpf } = req.body;

    // Validação básica do formato
    if (!cpf || !/^\d{11}$/.test(cpf)) {
      return res.render('index', {
        result: null,
        error: '❌ CPF deve conter exatamente 11 dígitos numéricos.'
      });
    }

    // Verificação no cache
    const existingCPF = await CPF.findOne({ cpf }).maxTimeMS(300000);
    if (existingCPF) {
      return res.render('index', {
        result: {
          cpf: formatCPF(existingCPF.cpf),
          isValid: existingCPF.isValid,
          message: '✅ Resultado obtido do banco de dados',
          cached: true
        },
        error: null
      });
    }

    // Consulta à API externa
    try {
      const response = await axios.get(`https://test-nuvem.onrender.com/verificar-cpf?cpf=${cpf}`, {
        timeout: 300000 // 5 minutos
      });

      // Processa a resposta da API
      let isValid;
      if (typeof response.data === 'object' && response.data !== null) {
        isValid = Boolean(response.data.valido); // Converte objeto para booleano
      } else {
        isValid = Boolean(response.data); // Caso seja true/false diretamente
      }

      // Armazena no MongoDB
      const newCPF = new CPF({ cpf, isValid });
      await newCPF.save();

      return res.render('index', {
        result: {
          cpf: formatCPF(cpf),
          isValid,
          message: '✅ Resultado obtido da API externa',
          cached: false
        },
        error: null
      });

    } catch (apiError) {
      console.error('Erro na API externa:', apiError);
      if (apiError.code === 'ECONNABORTED') {
        throw new Error('⌛ A validação está demorando mais que o normal. Por favor, tente novamente mais tarde.');
      }
      throw apiError;
    }

  } catch (error) {
    console.error('Erro na validação:', error);
    res.render('index', {
      result: null,
      error: error.message || '❌ Ocorreu um erro ao validar o CPF. Por favor, tente novamente.'
    });
  }
});

// Função auxiliar para formatar CPF
function formatCPF(cpf) {
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

// Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});