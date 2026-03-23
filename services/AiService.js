import axios from "axios";

const CTRL = "[ThresholdAIService]";

export const requestThresholdProfileFromBackM = async (equipment) => {
  const backMBaseUrl = process.env.BACKM_BASE_URL || "http://localhost:5000";
  const url = `${backMBaseUrl}/api/ai/thresholds/generate`;

  console.log(`${CTRL} Requesting threshold profile`, {
    url,
    nodeId: equipment?.nodeId,
    equipmentId: equipment?._id,
  });

  const response = await axios.post(
    url,
    { equipment },
    {
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  if (!response?.data?.success || !response?.data?.data) {
    throw new Error("BackM returned an invalid threshold generation response");
  }

  console.log(`${CTRL} Threshold profile received successfully`, {
    nodeId: response.data.data.nodeId,
  });

  return response.data.data;
};