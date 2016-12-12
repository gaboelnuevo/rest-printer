var express = require('express'),
  bodyParser = require('body-parser'),
  imagemagick,
  jwt = require('jsonwebtoken');

var app = express();
var printer = require('printer');
var config = require('./config.json');

if (process.platform === 'win32') {
  try {
    imagemagick = require('imagemagick-native');
  } catch (e) {
    throw 'please install imagemagick-native: `npm install imagemagick-native`'
  }
}

function checksum(str, algorithm, encoding) {
  return crypto
    .createHash(algorithm || 'md5')
    .update(str, 'utf8')
    .digest(encoding || 'hex')
}

function sendToPrinter(options) {
  if (process.platform === 'win32' && options.type === 'PDF') {
    // First convert PDF into
    imagemagick.convert({
      srcData: options.data,
      srcFormat: 'PDF',
      format: 'EMF',
    }, function(err, buffer) {
      if (err) {
        throw 'something went wrong on converting to EMF: ' + err;
      }
      // Now we have EMF file, send it to printer as EMF format
      sendToPrinter({
        data: buffer,
        type: 'EMF',
        printer: options.printerName,
        success: options.onSuccess,
        error: options.onError
      });
    });
  } else {
    printer.printDirect({
      data: options.data,
      type: options.type,
      printer: options.printerName,
      success: options.onSuccess,
      error: options.onError
    });
  }
}

app.use(bodyParser.json());

app.use(function(req, res, next) {

  // check header or url parameters or post parameters for token
  var token = req.body.token || req.query.token || req.headers['x-access-token'];

  // decode token
  if (token) {

    // verifies secret and checks exp
    jwt.verify(token, config.secret, function(err, decoded) {
      if (err) {
        return res.json({
          success: false,
          message: 'Failed to authenticate token.'
        });
      } else {
        // if everything is good, save to request for use in other routes
        req.decoded = decoded;
        next();
      }
    });

  } else {
    // if there is no token
    // return an error
    if (config.security) {
      return res.status(403).send({
        success: false,
        message: 'No token provided.'
      });
    } else {
      next();
    }
  }
});

app.get('/', function(req, res) {
  res.send('Ready for print!');
});

app.get('/printers', function(req, res) {
  var printers = printer.getPrinters() || [];
  if (req.decoded && req.decoded.action && req.decoded.action !== 'get_printers') {
    return res.status(401)
      .json({
        success: false,
        message: 'unauthorized action'
      });
  }
  res.json(printers.map(function(x) {
    return {
      name: x.name,
      isDefault: x.isDefault
    }
  }));
});

app.post('/print', function(req, res) {
  if (req.decoded && req.decoded.action && req.decoded.action !== 'print') {
    return res.status(401)
      .json({
        success: false,
        message: 'unauthorized action'
      });
  }
  if (req.decoded && req.decoded.printer && req.decoded.printer !== req.body.printer) {
    return res.status(401)
      .json({
        success: false,
        message: 'unauthorized printer'
      });
  }
  if (req.decoded && req.decoded.type && req.decoded.type !== req.body.type) {
    return res.status(401)
      .json({
        success: false,
        message: 'unauthorized type'
      });
  }
  if (req.body.data) {
    var data = new Buffer(req.body.data, 'base64');
    if (req.decoded && req.decoded.checkSum && req.decoded.checkSum !== checksum(data)) {
      return res.status(401)
        .json({
          success: false,
          message: 'Failed to validate check sum.'
        });
    }
    sendToPrinter({
      data: data,
      type: req.body.type || 'PDF',
      printerName: req.body.printer,
      onSuccess: function(id) {
        res.json({
          success: true,
          status: 'success',
          jobId: id
        });
      },
      onError: function(err) {
        res.status(403).json({
          status: 'failed',
          error: 'error on printing: ' + err
        });
      }
    });
  } else {
    res.status(400).json({
      status: 'failed',
      error: 'file data not found'
    });
  }
});

app.listen(config.port || 3000, function() {
  console.log('App listening on port ' + config.port || 3000 + '!');
});
