import { PavementData } from "../types";

export const generateMockData = (): PavementData[] => {
  const data: PavementData[] = [];
  const years = [2020, 2021, 2022, 2023, 2024];
  const routes = ["國道1號", "國道3號", "國道4號"];
  
  years.forEach(year => {
    routes.forEach(route => {
      const directions = route === "國道4號" ? ["東向", "西向"] : ["南下", "北上"];
      const lanes = route === "國道4號" ? ["內側車道", "外側車道"] : ["內側車道", "中線車道", "外側車道"];
      
      directions.forEach(direction => {
        lanes.forEach(lane => {
          // Generate 50km of data at 0.1km intervals
          let currentIri = 0.9 + Math.random() * 0.5; // Starts around 0.9 - 1.4
          let currentSn = 60 - Math.random() * 10;
          
          for (let mileage = 0; mileage <= 50; mileage += 0.1) {
            // Add some random walk to make it look realistic
            currentIri += (Math.random() - 0.45) * 0.1;
            currentSn += (Math.random() - 0.45) * 2;
            
            // Add some localized degradation (e.g., bridge joints, heavy traffic zones)
            if (mileage > 15 && mileage < 18) {
              currentIri += (lane === '外側車道' ? 0.3 : 0.15); // Outer lane degrades faster
              currentSn -= 5;
            }
            
            // Maintenance happened in 2023 for Hwy 1 Southbound 10k-20k
            if (year >= 2023 && route === "國道1號" && direction === "南下" && mileage >= 10 && mileage <= 20) {
              currentIri = 0.8 + Math.random() * 0.2;
              currentSn = 65 + Math.random() * 5;
            }

            // Clamp values to realistic ranges for the new scale
            currentIri = Math.max(0.6, Math.min(3.5, currentIri));
            currentSn = Math.max(20, Math.min(80, currentSn));

            data.push({
              year,
              route,
              direction,
              lane,
              mileage: Number(mileage.toFixed(1)),
              iri: Number(currentIri.toFixed(2)),
              sn: Number(currentSn.toFixed(1))
            });
          }
        });
      });
    });
  });
  
  return data;
};
