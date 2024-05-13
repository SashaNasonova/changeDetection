# changeDetection
Change detection scripts 

Approach:
1. Load in sample fire perimeter as an asset (data\K61884_2021.shp)
2. Open ccd_l8_tBreak.js in GEE code editor
3. Change root folder to where the fire perimeter is stored (line 47)
4. Run Script which will export tBreak and magnitude raster to Google Drive
6. Download to local drive
7. Mosaic mag and tBreak rasters (sample outputs are located in the data\ouputs folder)
