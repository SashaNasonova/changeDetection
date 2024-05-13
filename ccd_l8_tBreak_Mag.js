/*
 CCDC Google Earth Engine implementation: https://developers.google.com/earth-engine/apidocs/ee-algorithms-temporalsegmentation-ccdc
 Tools to simplify working with the ccdc output array iamge: https://gee-ccdc-tools.readthedocs.io/en/latest/index.html
 Based on this paper: https://www.sciencedirect.com/science/article/abs/pii/S0034425714000248
 
 Step 1: Define parameters epsg, startdate and enddate for the imagery to use (I selected 2015 as the start because the L8 record was sparse earlier)
 Step 2: Define dates for the change detection in decimal years
 Step 3: Define maxChangeBand (the band to use to calculate maximum change, default swir2)
 Step 4: Define runtype to select if you would like to run the whole province by TSA or select one of the TSAs. In this case TSA 33 is the test 
 Step 5: Change line 119 to point to your folder with polygons
 Step 5: Scroll down to line 152 to alter ccdc parameters if needed
 
*/

/*

TODO: add a mosaic by sensor and date so there are no increase in number of observations due to overlap
*/

function getDateDecimalYear(date) {
  var currentDate = ee.Date(date);
  var year = ee.Number(currentDate.get('year'));
  var decimalYear = year.add(currentDate.getFraction('year'));
  return decimalYear;
}

//Global Vars
//###############################
//Desired CRS for output tiles
var epsg = 'EPSG:3005';
//Number of CCDC segment to export, suggest 8
var num_seg_for_exprt = 8; 
// Shorten time-series from 1986.
var startdate = '2015-01-01';
var enddate = ee.Date(Date.now()).format('YYYY-MM-dd');

// Maximum change time-frame  
var t1 = 2021.0;
var t2 = 2022.0; // by quarter {year}.25, {year}.5, {year}.75 
print(t2);

var t1_str = '2021Q1';
var t2_str = '2021Q4';

var maxChangeBand = 'swir2'; //try swir2, nbr, ndvi
var runtype = 'test'; // running for a test area or for the whole province (bc)?
var root = 'users/sashanasonova/'

// CCDC variables
var breakpointBands = ['green','red','nir','swir1','swir2','nbr','ndvi']
var tmaskBands = ['green','swir1'] //default green and swir1, used to mask out clouds, can be None
var lambda = 20 //change this if needed, penalty regression parameter to reduce overfitting
var minObservations = 6 //default is 6,tried 4,bump up to 8 to account for overlap? Number of observations before a break is confirmed
var dateFormat = 1 //added dateFormat 1 for decimal years
var maxIterations = 25000 // default is 25000
var minNumOfYearsScaler = 0.25 

//###############################

//// Functions
function NBR_L8(img) {
  //nbr = (nir-swir)/(nir+swir)
  var nbr = img.normalizedDifference(['SR_B5', 'SR_B7'])
  .rename('nbr')
  .copyProperties(img, ['system:time_start']);
  return(img.addBands(nbr));
}

function NDVI_L8(img) {
  //nbr = (nir-swir)/(nir+swir)
  var ndvi = img.normalizedDifference(['SR_B5', 'SR_B4'])
  .rename('ndvi')
  .copyProperties(img, ['system:time_start']);
  return(img.addBands(ndvi));
}

//Function applies saling factors for Landsat 8, clips to geometry 
function applyScaleFactors_ls8(image) {
  var date = image.get('system:time_start');
  var opticalBands = image.select('SR_B.').multiply(0.0000275).add(-0.2);
  var thermalBands = image.select('ST_B.*').multiply(0.00341802).add(149.0);
  return image.addBands(opticalBands, null, true)
              .addBands(thermalBands, null, true)
              .clip(geometry)
              .set({'system:time_start':date});
}

function mask_LS_C2(image) {
  // Bits 3 and 5 are cloud shadow and cloud, respectively.
  var cloudDialated = (1 << 1);
  var snowMask = (1 << 5);
  var cloudShadowBitMask = (1 << 3);
  var cloudsBitMask = (1 << 4);
  // Get the pixel QA band.
  var qa = image.select('QA_PIXEL');
  // Both flags should be set to zero, indicating clear conditions.
  var mask = qa.bitwiseAnd(cloudShadowBitMask).eq(0)
                .and(qa.bitwiseAnd(cloudsBitMask).eq(0))
                .and(qa.bitwiseAnd(cloudDialated).eq(0))
                    .and(qa.bitwiseAnd(snowMask).eq(0));
  return image.updateMask(mask);
}

//Function renames LS8 bands to generic band names
var name_ls8_bands = function(image)
{
  return image.select(['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7','ST_B10','nbr','ndvi'],
  ['blue','green','red','nir','swir1','swir2','therm','nbr','ndvi']);
};

/*
################################## CODE #####################################################
*/

if (runtype == 'bc'){
  var tsa_list = ['tsa_01','tsa_02','tsa_03','tsa_04','tsa_05','tsa_07','tsa_08','tsa_09',
  'tsa_10','tsa_11','tsa_12','tsa_13','tsa_14','tsa_15','tsa_16','tsa_17','tsa_18',
  'tsa_19','tsa_20','tsa_21','tsa_22','tsa_23','tsa_24_north', 'tsa_24_south',
  'tsa_25','tsa_26','tsa_27','tsa_29','tsa_30',
  'tsa_31','tsa_33','tsa_37','tsa_38','tsa_39',
  'tsa_40','tsa_41','tsa_43','tsa_44','tsa_45',
  'tsa_46','tsa_47','tsa_48']} else {var tsa_list = ['K61884_2021']}

for (var tsa in tsa_list){
var export_folder = tsa_list[tsa] + '_' + t1_str + '_' + t2_str;
//print(export_folder)
var tsa_name = root + tsa_list[tsa];
var geometry = ee.FeatureCollection(tsa_name);

//Import gee-ccdc-tools API for converting CCDC output from array to image for export 
var utils = require('users/parevalo_bu/gee-ccdc-tools:ccdcUtilities/api');

//Declare Landsat 5,7 & 8 Collection 2 datasets
var dataset_ls8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').filterBounds(geometry).filterDate(startdate,enddate);
//print(dataset_ls8)

//var dataset_ls9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2').filterBounds(geometry).filterDate(startdate,enddate);
//print(dataset_ls9)

//Map scaling and naming functions over appropriate Landsat datasets 
var merged = dataset_ls8
    .map(mask_LS_C2) //cloud mask
    .map(applyScaleFactors_ls8) //scale factors
      .map(NBR_L8) // calculate nbr
      .map(NDVI_L8) // calculate ndvi
        .map(name_ls8_bands); // rename to common names

//print(merged);

//// Print some information      
// Get the minimum and maximum acquisition dates
var mindate = merged.aggregate_min('system:time_start');
var maxdate = merged.aggregate_max('system:time_start');

print('Minimum Acquisition Date:', ee.Date(mindate)); // this is slow
print('Maximum Acquisition Date:', ee.Date(maxdate));

//Run the CCDC algorithm over the merged Landsat collection, using 'green','red','nir','swir1','swir2' for 
//breakpoint detection and 'green' & 'swir2' for tmask.  
var ccdc_array = ee.Algorithms.TemporalSegmentation.Ccdc({collection:merged,
  breakpointBands: breakpointBands,
  tmaskBands: tmaskBands, //default green and swir1, used to mask out clouds, can be None
  lambda: lambda, //change this if needed, penalty regression parameter to reduce overfitting
  minObservations: minObservations, //default is 6,tried 4,bump up to 8 to account for overlap? Number of observations before a break is confirmed
  dateFormat: dateFormat, //added dateFormat 1 for decimal years
  maxIterations: maxIterations, // default is 25000
  minNumOfYearsScaler: minNumofYearsScaler // default 1.33, minimum length of a temporal segment
});
//print(ccdc_array)

// Build ccdc image
var v = 'chg_' + t1_str + '_' + t2_str + '_l8_lambda20_minYears0pt25_greenswir1msk_6minobs';
var ccdc_img_out = utils.CCDC.buildCcdImage(ccdc_array,num_seg_for_exprt,[maxChangeBand]);
//print(ccdc_img_out);

// Define segments 
var segs = ["S1", "S2","S3","S4","S5","S6","S7","S8"];

// Gets the magnitude (MAG), time (tBreak) and total number of changes that occured within the specified period (num)
var filteredChanges = utils.CCDC.filterMag(ccdc_img_out,t1,t2,maxChangeBand, segs);
//print(filteredChanges);

//Export the resulting tBreak and MAG images to Google Drive
Export.image.toDrive({image:filteredChanges.select(['tBreak']),
  description:tsa_list[tsa] + '_'+ maxChangeBand + '_tBreak_' + v,
  folder: export_folder,
  region:geometry,
  scale:30,
  crs:epsg,
  shardSize:256,
  fileDimensions:1024,
  maxPixels:10000000000000,
  skipEmptyTiles:true});

Export.image.toDrive({image:filteredChanges.select(['MAG']),
  description:tsa_list[tsa] + '_' + maxChangeBand + '_mag_' + v,
  folder: export_folder,
  region:geometry,
  scale:30,
  crs:epsg,
  shardSize:256,
  fileDimensions:1024,
  maxPixels:10000000000000,
  skipEmptyTiles:true});
}



